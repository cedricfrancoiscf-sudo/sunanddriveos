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
