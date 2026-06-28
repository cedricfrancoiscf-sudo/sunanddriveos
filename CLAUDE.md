# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (`frontend/`)
```bash
pnpm dev          # Vite dev server
pnpm build        # tsc -b && vite build
pnpm lint         # biome check src/
pnpm format       # biome format --write src/
pnpm typecheck    # tsc --noEmit
pnpm test:e2e     # Playwright (all specs)
pnpm test:e2e:ui  # Playwright UI mode
```

Run a single Playwright spec:
```bash
npx playwright test tests/e2e/28-monkey-admin.spec.ts
```

### Backend (`backend/`)
```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsup src/server.ts src/init.ts
pnpm migrate      # tsx src/prisma/migrate.ts
pnpm seed         # tsx src/prisma/seed/master.ts
pnpm generate     # prisma generate (both schemas)
```

## Architecture

### Overview
SaaS multi-tenant fleet management for Getaround hosts. Each tenant has its own database schema; a master schema tracks tenants and super-admins.

### Frontend (`frontend/src/`)
- **Framework**: React 18 + Vite + TypeScript, React Router v6, TanStack Query v5
- **Styling**: Tailwind CSS; linter/formatter is Biome (not ESLint/Prettier)
- **Auth**: JWT stored in `localStorage` as `auth_token`; super-admin uses `superadmin_token`
- **Routing**: `App.tsx` — all routes defined here. Protected routes use `ProtectedLayout` = `ProtectedRoute` wrapping `AppLayout` (sidebar + header + `<Outlet>`).
- **Roles**: `admin`, `carkeeper`, `exploitation`, `comptable`. `user.role` and `user.roles[]` (multi-role).
- **Modules**: each feature lives in `src/modules/<feature>/` with its page(s) and API file.

Key routes and their pages:
| Path | Component |
|------|-----------|
| `/vehicles` | Fleet list |
| `/vehicles/:id` | Vehicle detail (blocking, costs, ratings, carkeepers) |
| `/rentals` | Rental list with month filter |
| `/messages` | Message inbox |
| `/planning` | Gantt-style grid |
| `/intelligence` | KPIs + AI chat |
| `/intelligence/report` | CEO report (annual/monthly) |
| `/intelligence/ratings` | Per-vehicle Getaround ratings |
| `/rentability` | Profitability per vehicle |
| `/accessories` | Accessories + car seats |
| `/maintenance` | Maintenance records |
| `/technical-control` | CT records (singular path) |
| `/settings` | Users, accounts, webhooks, theme |

### Backend (`backend/src/`)
- **Framework**: Express + TypeScript, compiled with tsup
- **ORM**: Prisma with two schemas — `src/prisma/master/schema.prisma` (tenants, superadmin) and `src/prisma/tenant/schema.prisma` (per-tenant data)
- **Modules**: `src/modules/<feature>/<feature>.routes.ts` — all mounted under `/api/v1/`
- **Plan gating**: `requirePlan('pro')` middleware on pro-only routes (intelligence, scoring, AI, sequences, exports)
- **Auth middleware**: `requireActiveSubscription` runs on all API routes except auth, billing webhook, health, iCal

### E2E Tests (`frontend/tests/e2e/`)
- Auth stored in `tests/e2e/.auth/user.json` via setup script — no login needed in specs
- Test credentials: `admin@sunanddrive.fr` / `password`, carkeeper: `carkeeper.test@sunanddrive.fr`
- Tenant slug: `sun-and-drive`; base URL: `https://appli.sunanddrive.com`
- Seed/cleanup helpers in `tests/e2e/helpers/auth.ts`
- Spec numbering: 00-setup → 28-monkey-admin (exhaustive UI monkey test)

---

## État du projet & règles immuables

### Règles absolues
- Zéro valeur codée en dur — tout paramètre configurable
  passe par CompanySettings ou les variables d'environnement
- Zéro suppression physique de données — déactivation
  uniquement (isActive=false) pour tous les modèles métier
- Zéro modification des calculs validés sans décision
  explicite de Cédric François (fondateur, seul décideur)
- Avant tout prompt de modification : lire les fichiers
  concernés et faire un audit si le contenu est incertain

### Formules validées et figées

**CA mensuel**
Méthode : prorata jours sur chaque mois chevauché
  caParMois[m] += ownerPayout × (joursChevauchemoisM / totalJours)
Pour les locations booked : ownerPayout est null,
  on utilise grossRevenue (fourni par l'API GA dès la résa,
  valeur réelle non estimée).
Cette méthode est différente des vues GA (Performance et
Paiements) — l'écart est documenté dans /documentation
onglet "Dossier technique" section 11.

**Taux d'occupation**
- Taux brut : joursLoués / joursCalendaires (méthode interne,
  performance absolue)
- Taux corrigé : joursLoués / (joursCalendaires - joursIndispo)
  comparable à la méthode Getaround, affiché dans Intelligence
Les alertes de sous-utilisation se basent sur le taux corrigé.

**Signal de revente ROI (roi.service.ts)**
- "vendre_maintenant" : moisOptimal === 0 ET prêt déjà soldé
  (!pretEncoreEnCours)
- declining3 supprimé (commit 6c790fa) — faux positif quand
  marketValue < capitalRestant avec prêt en cours
- Décote basée sur vehicle.year (âge réel), pas purchaseDate
- Taux configurables dans CompanySettings (DEFAULT_SETTINGS
  = valeurs par défaut uniquement)

**Boîtier Connect**
Montant configurable via CompanySettings.boitierConnectAmount
(défaut 25€ si null). Jamais codé en dur.

### Bugs résolus (ne pas réintroduire)
- TechnicalControl table droppée → MaintenanceTask est
  l'unique source de vérité pour les CT
- Logo URL : utiliser PUBLIC_URL + normalizeLogoUrl,
  jamais l'IP locale du NAS
- requireActiveSubscription doit s'exécuter APRÈS requireAuth
- Service Worker supprimé (VitePWA retiré, SW désenregistré
  dans main.tsx)
- Payouts GA : pas de per_page, fenêtres alignées au 1er
  du mois, millisecondes strippées des timestamps
- Rôle carkeeper : admin override carkeeper quand user
  cumule les deux rôles (planning visibility)

### État Playwright
~295 tests passés. Échecs résiduels connus :
- data-testid manquants dans VehicleDetailPage.tsx
  (valeur-revente-section, garanties-section,
  critair-section, btn-qr-code)
- SuperAdmin strict mode selector issues

### Déploiement NAS
Git non installé sur le NAS. Workflow :
  wget zip GitHub → python3 extract → cp files
  → docker-compose up -d --build
Service backend : "backend" (pas "sunanddriveos-backend")
Auth tokens : localStorage auth_token (tenant),
  superadmin_token (SuperAdmin)

### Données de référence Sun and Drive (juin 2026)
Notes Getaround par véhicule (saisies en base) :
  EZ480LT 4.82/77 · FZ375EZ 4.91/69 · FZ671YT 4.71/56
  EL113HY 4.76/117 · ET672TZ 4.59/62
  FC275PK 4.55/64 · FY542RR 4.78/69
