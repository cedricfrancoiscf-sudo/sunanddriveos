import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth';
import { getMasterClient, getTenantClient } from '../../prisma/client';
import { hashPassword } from '../auth/auth.service';
import jwt from 'jsonwebtoken';
import { resetCorruptedPayouts } from '../getaround-sync/getaround-sync.service';
import { analyzeAndProcessMessage, type RentalForMessaging } from '../messages/messaging.service';
import { createGetaroundClient } from '../getaround-sync/getaround-api';
import { decrypt } from '../../utils/crypto';
import { sendEmail } from '../../utils/mailer';

const router: Router = Router();
router.use(requireAuth, requireSuperAdmin);

const PLANS = ['starter', 'pro', 'enterprise'] as const;

// ─── Stats globales ────────────────────────────────────────────────────────────

// GET /api/v1/superadmin/stats
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const threeDaysFromNow = new Date(now.getTime() + 3 * 86_400_000);

    const [total, active, onTrial, perPlan, trialExpiringSoon, activeCompanies] = await Promise.all([
      master.company.count(),
      master.company.count({ where: { isActive: true } }),
      master.company.count({ where: { isActive: true, trialEndsAt: { gte: now } } }),
      master.company.groupBy({ by: ['plan'], _count: { id: true } }),
      master.company.count({ where: { isActive: true, trialEndsAt: { gte: now, lte: threeDaysFromNow } } }),
      master.company.findMany({
        where: { isActive: true },
        select: {
          tenantDbUrl: true,
          plan: true,
          subscriptionMode: true,
          forcedPrice: true,
          tenantEvents: { where: { occurredAt: { gte: sevenDaysAgo } }, take: 1, select: { id: true } },
        },
      }),
    ]);

    const churnRisk = activeCompanies.filter(c => c.tenantEvents.length === 0).length;

    // MRR basé sur les vrais prix d'abonnement (pas les payouts Getaround)
    const planConfigs = await master.planConfig.findMany({ select: { name: true, priceMonthly: true } });
    const planPrices = Object.fromEntries(planConfigs.map(p => [p.name, p.priceMonthly ?? 0]));

    const mrrTotal = Math.round(
      activeCompanies.reduce((sum, c) => {
        if (c.subscriptionMode === 'trial') return sum;
        const price = c.subscriptionMode === 'forced'
          ? (c.forcedPrice ?? 0)
          : (planPrices[c.plan] ?? 0);
        return sum + price;
      }, 0),
    );

    const planDistribution = { starter: 0, pro: 0, enterprise: 0 };
    for (const p of perPlan) {
      planDistribution[p.plan as keyof typeof planDistribution] = p._count.id;
    }

    res.json({
      stats: {
        total,
        active,
        inactive: total - active,
        onTrial,
        perPlan: Object.fromEntries(perPlan.map(p => [p.plan, p._count.id])),
        mrrTotal,
        arrTotal: mrrTotal * 12,
        tenantCount: active,
        churnRisk,
        trialExpiringSoon,
        planDistribution,
      },
    });
  } catch (err: unknown) { next(err); }
});

// ─── Sociétés (tenants) ────────────────────────────────────────────────────────

// GET /api/v1/superadmin/companies
router.get('/companies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const threeDaysFromNow = new Date(now.getTime() + 3 * 86_400_000);

    const companies = await master.company.findMany({
      select: {
        id: true, name: true, slug: true, logoUrl: true, primaryColor: true,
        plan: true, isActive: true, trialEndsAt: true, createdAt: true, updatedAt: true,
        stripeCustomerId: true, stripeSubscriptionId: true,
        _count: { select: { billingEvents: true } },
        tenantEvents: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const companiesWithStats = await Promise.all(companies.map(async (c) => {
      const { tenantEvents, ...rest } = c;
      const lastActivityAt = tenantEvents[0]?.occurredAt?.toISOString() ?? null;
      const alertInactive = !lastActivityAt || new Date(lastActivityAt) < sevenDaysAgo;
      const alertTrial = c.trialEndsAt != null && c.trialEndsAt >= now && c.trialEndsAt <= threeDaysFromNow;

      try {
        const fullCompany = await master.company.findUnique({ where: { id: c.id }, select: { tenantDbUrl: true } });
        if (!fullCompany?.tenantDbUrl) return { ...rest, tenantStats: null, lastActivityAt, alertInactive, alertTrial };

        const db = getTenantClient(fullCompany.tenantDbUrl);
        const [userCount, vehicleCount, rentalCount] = await Promise.all([
          db.user.count({ where: { isActive: true } }),
          db.vehicle.count({ where: { isActive: true } }),
          db.rental.count({ where: { status: 'completed' } }),
        ]);
        return { ...rest, tenantStats: { userCount, vehicleCount, rentalCount }, lastActivityAt, alertInactive, alertTrial };
      } catch {
        return { ...rest, tenantStats: null, lastActivityAt, alertInactive, alertTrial };
      }
    }));

    res.json({ companies: companiesWithStats });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/superadmin/companies/:id
router.get('/companies/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { id: (req.params.id as string) },
      select: {
        id: true, name: true, slug: true, logoUrl: true,
        primaryColor: true, secondaryColor: true,
        plan: true, isActive: true, trialEndsAt: true,
        createdAt: true, updatedAt: true,
        stripeCustomerId: true, stripeSubscriptionId: true, icalToken: true,
        siret: true, managerName: true, phone: true, contactEmail: true,
        address: true, city: true, postalCode: true,
        subscriptionStatus: true, subscriptionMode: true, subscriptionStartedAt: true,
        forcedPrice: true, commercialNote: true,
        onboardingCompleted: true, onboardingStep: true,
        billingEvents: {
          orderBy: { processedAt: 'desc' },
          take: 20,
          select: { id: true, type: true, stripeEventId: true, processedAt: true, data: true },
        },
      },
    });
    if (!company) { res.status(404).json({ error: 'Société introuvable' }); return; }

    // Stats tenant
    let tenantStats = null;
    try {
      const fullCompany = await master.company.findUnique({ where: { id: (req.params.id as string) }, select: { tenantDbUrl: true } });
      if (fullCompany?.tenantDbUrl) {
        const db = getTenantClient(fullCompany.tenantDbUrl);
        const [userCount, vehicleCount, rentalCount, activeRentals] = await Promise.all([
          db.user.count({ where: { isActive: true } }),
          db.vehicle.count({ where: { isActive: true } }),
          db.rental.count({ where: { status: 'completed' } }),
          db.rental.count({ where: { status: 'active' } }),
        ]);
        tenantStats = { userCount, vehicleCount, rentalCount, activeRentals };
      }
    } catch { /* ignore si tenant DB inaccessible */ }

    res.json({ company, tenantStats });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/companies — créer une société
router.post('/companies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug : lettres minuscules, chiffres, tirets uniquement').optional(),
      tenantDbUrl: z.string().url(),
      plan: z.enum(PLANS).default('starter'),
      trialDays: z.number().int().min(0).max(365).default(14),
      primaryColor: z.string().default('#01696e'),
      siret: z.string().optional(),
      managerName: z.string().optional(),
      phone: z.string().optional(),
      contactEmail: z.string().email().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      mode: z.enum(['standard', 'trial', 'forced']).default('standard'),
      adminPassword: z.string().min(8).optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    function autoSlug(name: string): string {
      return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    const slug = body.data.slug ?? autoSlug(body.data.name);

    const master = getMasterClient();
    const exists = await master.company.findUnique({ where: { slug } });
    if (exists) { res.status(409).json({ error: 'Ce slug est déjà utilisé' }); return; }

    const trialEndsAt = body.data.trialDays > 0
      ? new Date(Date.now() + body.data.trialDays * 86_400_000)
      : null;

    const company = await master.company.create({
      data: {
        name: body.data.name,
        slug,
        tenantDbUrl: body.data.tenantDbUrl,
        plan: body.data.plan,
        primaryColor: body.data.primaryColor,
        trialEndsAt,
        isActive: true,
        siret: body.data.siret,
        managerName: body.data.managerName,
        phone: body.data.phone,
        contactEmail: body.data.contactEmail,
        address: body.data.address,
        city: body.data.city,
        postalCode: body.data.postalCode,
        subscriptionMode: body.data.mode,
      },
      select: { id: true, name: true, slug: true, plan: true, isActive: true, trialEndsAt: true, createdAt: true, contactEmail: true, managerName: true },
    });

    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    const generatedPassword = body.data.adminPassword ?? Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    let adminCreated = false;
    if (body.data.contactEmail) {
      try {
        const db = getTenantClient(body.data.tenantDbUrl);
        const passwordHash = await hashPassword(generatedPassword);
        await db.user.create({
          data: {
            email: body.data.contactEmail,
            name: body.data.managerName ?? body.data.name,
            role: 'admin',
            roles: ['admin'],
            passwordHash,
            isActive: true,
          },
        });
        adminCreated = true;
      } catch (e) { console.error('[CreateCompany] Erreur création user admin tenant:', e); }
    }

    if (body.data.contactEmail && adminCreated) {
      try {
        await sendEmail({
          to: body.data.contactEmail,
          subject: 'Bienvenue sur SunanddriveOS',
          html: `<p>Bonjour ${body.data.managerName ?? body.data.name},</p><p>Votre espace SunanddriveOS est prêt. Connectez-vous sur <a href="https://appli.sunanddrive.com">appli.sunanddrive.com</a></p><p>Email : ${body.data.contactEmail}<br/>Mot de passe temporaire : <strong>${generatedPassword}</strong></p><p>Pensez à changer votre mot de passe à la première connexion.</p>`,
        });
      } catch { /* non bloquant */ }
    }

    res.status(201).json({ company, generatedPassword: adminCreated ? generatedPassword : undefined });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/superadmin/companies/:id
router.put('/companies/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1).optional(),
      plan: z.enum(PLANS).optional(),
      isActive: z.boolean().optional(),
      trialEndsAt: z.string().datetime().nullable().optional(),
      primaryColor: z.string().optional(),
      logoUrl: z.string().url().nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const master = getMasterClient();
    const company = await master.company.update({
      where: { id: (req.params.id as string) },
      data: {
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.plan !== undefined ? { plan: body.data.plan } : {}),
        ...(body.data.isActive !== undefined ? { isActive: body.data.isActive } : {}),
        ...(body.data.trialEndsAt !== undefined ? { trialEndsAt: body.data.trialEndsAt ? new Date(body.data.trialEndsAt) : null } : {}),
        ...(body.data.primaryColor !== undefined ? { primaryColor: body.data.primaryColor } : {}),
        ...(body.data.logoUrl !== undefined ? { logoUrl: body.data.logoUrl } : {}),
      },
      select: { id: true, name: true, slug: true, plan: true, isActive: true, trialEndsAt: true, primaryColor: true },
    });

    res.json({ company });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/tenants/:slug/reset-payouts
// Remet à null tous les champs financiers + vide getaround_invoices → force recalcul propre
router.post('/tenants/:slug/reset-payouts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: (req.params.slug as string), isActive: true },
      select: { tenantDbUrl: true, name: true },
    });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const result = await resetCorruptedPayouts(db, req.params.slug as string);

    res.json({
      success: true,
      tenant: company.name,
      slug: req.params.slug,
      ...result,
      message: `Reset terminé. Lancez maintenant Recalculer les virements depuis les Paramètres.`,
    });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/companies/:id/set-plan — forcer un plan sans Stripe
router.post('/companies/:id/set-plan', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      plan: z.enum(PLANS),
      trialDays: z.number().int().min(0).max(3650).optional(), // 0 = no trial, absent = keep current
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const master = getMasterClient();
    const data: Record<string, unknown> = { plan: body.data.plan };
    if (body.data.trialDays !== undefined) {
      data.trialEndsAt = body.data.trialDays > 0
        ? new Date(Date.now() + body.data.trialDays * 86_400_000)
        : null;
    }
    const company = await master.company.update({
      where: { id: (req.params.id as string) },
      data,
      select: { id: true, name: true, slug: true, plan: true, trialEndsAt: true, stripeSubscriptionId: true },
    });
    res.json({ company });
  } catch (err: unknown) { next(err); }
});

// ─── Analytics par tenant ────────────────────────────────────────────────────

// GET /api/v1/superadmin/analytics
router.get('/analytics', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, slug: true, plan: true, isActive: true,
        trialEndsAt: true, tenantDbUrl: true,
        tenantEvents: {
          orderBy: { occurredAt: 'desc' },
          take: 200,
          select: { module: true, action: true, occurredAt: true },
        },
      },
    });

    const now = new Date();

    const analytics = await Promise.all(companies.map(async (c) => {
      let vehicleCount = 0;
      let rentalCount = 0;
      let messageCount = 0;

      try {
        const db = getTenantClient(c.tenantDbUrl);
        [vehicleCount, rentalCount, messageCount] = await Promise.all([
          db.vehicle.count({ where: { isActive: true } }),
          db.rental.count(),
          db.message.count(),
        ]);
      } catch { /* tenant DB inaccessible */ }

      const lastActivityAt = c.tenantEvents[0]?.occurredAt ?? null;
      const inactiveDays = lastActivityAt
        ? Math.floor((now.getTime() - new Date(lastActivityAt).getTime()) / 86_400_000)
        : null;

      const moduleUsage: Record<string, number> = {};
      for (const ev of c.tenantEvents) {
        moduleUsage[ev.module] = (moduleUsage[ev.module] ?? 0) + 1;
      }

      const trialDaysLeft = c.trialEndsAt
        ? Math.ceil((new Date(c.trialEndsAt).getTime() - now.getTime()) / 86_400_000)
        : null;

      // Détection erreur sync répétée : TenantEvent sync_error_repeated dans les 4 dernières heures
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      const alertSyncError = c.tenantEvents.some(
        ev => ev.module === 'sync' && ev.action === 'sync_error_repeated' && new Date(ev.occurredAt) >= fourHoursAgo
      );

      return {
        id: c.id, name: c.name, slug: c.slug, plan: c.plan,
        vehicleCount, rentalCount, messageCount,
        lastActivityAt: lastActivityAt?.toISOString() ?? null,
        inactiveDays,
        moduleUsage: Object.entries(moduleUsage)
          .sort((a, b) => b[1] - a[1])
          .map(([module, count]) => ({ module, count })),
        trialEndsAt: c.trialEndsAt?.toISOString() ?? null,
        trialDaysLeft,
        alertInactive: inactiveDays !== null && inactiveDays > 7,
        alertTrial: trialDaysLeft !== null && trialDaysLeft >= 0 && trialDaysLeft < 3,
        alertSyncError,
      };
    }));

    res.json({ analytics });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/superadmin/companies/:id/analytics — analytics usage par tenant
router.get('/companies/:id/analytics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { id: req.params.id as string },
      select: {
        tenantEvents: { orderBy: { occurredAt: 'desc' }, take: 1000 },
      },
    });
    if (!company) { res.status(404).json({ error: 'Société introuvable' }); return; }

    const now = new Date();
    const oneMonthAgo = new Date(now.getTime() - 30 * 86_400_000);
    const events = company.tenantEvents;

    // Usage par module
    const moduleUsage: Record<string, number> = {};
    for (const ev of events) moduleUsage[ev.module] = (moduleUsage[ev.module] ?? 0) + 1;

    const loginsThisMonth = events.filter(e => e.action === 'login' && new Date(e.occurredAt) >= oneMonthAgo).length;
    const lastLoginAt = events.find(e => e.action === 'login')?.occurredAt ?? null;

    // Graphique connexions 30 jours
    const dailyLogins: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const dayStr = d.toISOString().slice(0, 10);
      const count = events.filter(e => e.action === 'login' && e.occurredAt.toISOString().slice(0, 10) === dayStr).length;
      dailyLogins.push({ date: dayStr, count });
    }

    const ALL_MODULES = ['planning', 'rentals', 'vehicles', 'messages', 'intelligence', 'rentability', 'maintenance', 'accessories', 'settings'];
    const neverUsedModules = ALL_MODULES.filter(m => !moduleUsage[m]);

    // Score d'activation (0-5 : planning, rentals, messages, intelligence, settings)
    const activationModules = ['planning', 'rentals', 'messages', 'intelligence', 'settings'];
    const activationScore = activationModules.filter(m => moduleUsage[m]).length;

    res.json({
      moduleUsage: Object.entries(moduleUsage).map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count),
      neverUsedModules,
      loginsThisMonth,
      lastLoginAt: lastLoginAt?.toISOString() ?? null,
      dailyLogins,
      activationScore,
      activationTotal: activationModules.length,
    });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/superadmin/nps — vue d'ensemble NPS tous tenants
router.get('/nps', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const responses = await master.npsResponse.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { company: { select: { id: true, name: true, slug: true } } },
    });

    const avgScore = responses.length > 0
      ? Math.round((responses.reduce((s, r) => s + r.score, 0) / responses.length) * 10) / 10
      : null;

    const promoters = responses.filter(r => r.score >= 9).length;
    const passifs = responses.filter(r => r.score >= 7 && r.score <= 8).length;
    const detracteurs = responses.filter(r => r.score <= 6).length;
    const npsScore = responses.length > 0 ? Math.round(((promoters - detracteurs) / responses.length) * 100) : null;

    res.json({
      avgScore,
      npsScore,
      total: responses.length,
      promoters,
      passifs,
      detracteurs,
      responses: responses.map(r => ({
        id: r.id,
        companyId: r.companyId,
        companyName: r.company.name,
        companySlug: r.company.slug,
        score: r.score,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    });
  } catch (err: unknown) { next(err); }
});

// ─── Feedbacks tenants ────────────────────────────────────────────────────────

// GET /api/v1/superadmin/feedbacks
router.get('/feedbacks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;

    const feedbacks = await master.tenantFeedback.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
      },
      include: { company: { select: { id: true, name: true, slug: true } } },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    res.json({ feedbacks });
  } catch (err: unknown) { next(err); }
});

// PATCH /api/v1/superadmin/feedbacks/:id
router.patch('/feedbacks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ status: z.enum(['new', 'in_progress', 'done', 'rejected']) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Statut invalide' }); return; }

    const master = getMasterClient();
    const feedback = await master.tenantFeedback.update({
      where: { id: req.params.id as string },
      data: { status: body.data.status },
      select: { id: true, status: true },
    });
    res.json({ feedback });
  } catch (err: unknown) { next(err); }
});

// ─── Super admins ─────────────────────────────────────────────────────────────

// GET /api/v1/superadmin/admins
router.get('/admins', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const admins = await master.superAdmin.findMany({
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ admins });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/admins
router.post('/admins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const master = getMasterClient();
    const existing = await master.superAdmin.findUnique({ where: { email: body.data.email } });
    if (existing) { res.status(409).json({ error: 'Email déjà utilisé' }); return; }

    const passwordHash = await hashPassword(body.data.password);
    const admin = await master.superAdmin.create({
      data: { name: body.data.name, email: body.data.email.toLowerCase(), passwordHash },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    res.status(201).json({ admin });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/tenants/:slug/simulate-rental
router.post('/tenants/:slug/simulate-rental', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params as { slug: string };
    const master = getMasterClient();
    const company = await master.company.findUnique({ where: { slug }, select: { tenantDbUrl: true, isActive: true } });
    if (!company) { res.status(404).json({ error: 'Tenant non trouvé' }); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const vehicle = await db.vehicle.findFirst({
      where: { isActive: true },
      select: { id: true, licensePlate: true, make: true, model: true, parkingZone: true, deliveryPointName: true, getaroundAccountId: true },
    });
    if (!vehicle) { res.status(400).json({ error: 'Aucun véhicule actif pour ce tenant' }); return; }

    const now = new Date();
    const startAt = new Date(now.getTime() + 3_600_000);
    const endAt   = new Date(now.getTime() + 90_000_000);
    const testGetaroundId = `test_${Date.now()}`;

    console.log(`[SimulateRental] Tenant=${slug} — véhicule=${vehicle.licensePlate} getaroundId=${testGetaroundId}`);

    const rental = await db.rental.create({
      data: { getaroundId: testGetaroundId, vehicleId: vehicle.id, driverName: 'Test Locataire', status: 'booked', startAt, endAt, grossRevenue: 85.00 },
    });
    console.log(`[SimulateRental] Location créée — id=${rental.id}`);

    const message = await db.message.create({
      data: { rentalId: rental.id, direction: 'inbound', content: "Bonjour, j'ai besoin d'un siège auto pour mon fils de 2 ans. Merci", status: 'pending_approval' },
    });
    console.log(`[SimulateRental] Message créé — id=${message.id}`);

    if (vehicle.getaroundAccountId) {
      try {
        const account = await db.getaroundAccount.findUnique({
          where: { id: vehicle.getaroundAccountId },
          select: { apiKeyHash: true },
        });
        if (account) {
          const ga = createGetaroundClient(decrypt(account.apiKeyHash));
          const rentalData: RentalForMessaging = {
            id: rental.id, vehicleId: vehicle.id, driverName: 'Test Locataire',
            driverGetaroundId: null, getaroundId: testGetaroundId, startAt, endAt, status: 'booked',
            vehicle: { make: vehicle.make, model: vehicle.model, licensePlate: vehicle.licensePlate, parkingZone: vehicle.parkingZone, deliveryPointName: vehicle.deliveryPointName },
          };
          await analyzeAndProcessMessage({ id: message.id, content: message.content }, rentalData, db, ga);
          console.log(`[SimulateRental] Messagerie proactive déclenchée`);
        }
      } catch (e) { console.error('[SimulateRental] Erreur messagerie proactive:', e); }
    }

    res.json({ rentalId: rental.id, messageId: message.id, vehicleLicensePlate: vehicle.licensePlate, message: 'Simulation créée avec succès' });
  } catch (err) { next(err); }
});

// ─── Seed données de test (août 2026) ────────────────────────────────────────

// POST /api/v1/superadmin/seed-test-data
router.post('/seed-test-data', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ slug: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'slug requis dans le body' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: body.data.slug },
      select: { tenantDbUrl: true },
    });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);

    // Getaround client pour l'analyse IA
    let gaClient: ReturnType<typeof createGetaroundClient> | null = null;
    const gaAccount = await db.getaroundAccount.findFirst({
      where: { isActive: true },
      select: { apiKeyHash: true },
    });
    if (gaAccount) gaClient = createGetaroundClient(decrypt(gaAccount.apiKeyHash));

    const driverName = 'Test Playwright';
    const driverEmail = 'test.playwright@sunanddrive.fr';
    const driverGetaroundId = '999999';

    const SEED_CASES = [
      {
        getaroundId: 'test_playwright_cas1',
        vehicleGetaroundId: '1472640',
        startAt: new Date('2026-08-04T10:00:00'),
        endAt: new Date('2026-08-07T18:00:00'),
        status: 'booked' as const,
        message: "Bonjour, nous voyageons avec notre bébé de 8kg. Est-il possible d'avoir un siège auto adapté ? Merci d'avance",
        isCarSeat: true,
      },
      {
        getaroundId: 'test_playwright_cas2',
        vehicleGetaroundId: '1212044',
        startAt: new Date('2026-08-11T09:00:00'),
        endAt: new Date('2026-08-14T19:00:00'),
        status: 'booked' as const,
        message: "Bonjour, nous avons besoin d'un siège auto pour notre enfant de 15kg. Pouvez-vous nous en fournir un ?",
        isCarSeat: true,
      },
      {
        getaroundId: 'test_playwright_cas3',
        vehicleGetaroundId: '1488949',
        startAt: new Date('2026-08-18T14:00:00'),
        endAt: new Date('2026-08-21T11:00:00'),
        status: 'booked' as const,
        message: "Bonjour, mon fils de 25kg a besoin d'un rehausseur pour le trajet. Est-ce que vous en avez un disponible ?",
        isCarSeat: true,
      },
      {
        getaroundId: 'test_playwright_cas4',
        vehicleGetaroundId: '1487582',
        startAt: new Date('2026-08-25T08:00:00'),
        endAt: new Date('2026-08-28T20:00:00'),
        status: 'active' as const,
        message: "Bonjour, la voiture fait un bruit bizarre au démarrage, comme un grincement. Est-ce normal ? Je suis un peu inquiet pour le trajet prévu demain.",
        isCarSeat: false,
      },
      {
        getaroundId: 'test_playwright_cas5',
        vehicleGetaroundId: '1470595',
        startAt: new Date('2026-08-01T09:00:00'),
        endAt: new Date('2026-08-03T18:00:00'),
        status: 'active' as const,
        message: "Bonjour, je suis vraiment désolé mais j'ai un empêchement et je ne pourrai pas rendre la voiture à l'heure prévue. Je pense avoir 2h de retard. Comment procéder ?",
        isCarSeat: false,
      },
    ];

    let rentalsCreated = 0;
    let messagesCreated = 0;
    let carSeatRequestsTriggered = 0;

    for (const cas of SEED_CASES) {
      const vehicle = await db.vehicle.findFirst({
        where: { getaroundId: cas.vehicleGetaroundId },
        select: { id: true, make: true, model: true, licensePlate: true, parkingZone: true, deliveryPointName: true },
      });
      if (!vehicle) {
        console.warn(`[SeedTestData] Véhicule getaroundId=${cas.vehicleGetaroundId} introuvable, cas ignoré`);
        continue;
      }

      // Idempotence — skip si déjà créé
      const existing = await db.rental.findFirst({ where: { getaroundId: cas.getaroundId }, select: { id: true } });
      if (existing) continue;

      const rental = await db.rental.create({
        data: {
          getaroundId: cas.getaroundId,
          vehicleId: vehicle.id,
          driverName,
          driverEmail,
          driverGetaroundId,
          startAt: cas.startAt,
          endAt: cas.endAt,
          status: cas.status,
          isTest: true,
        },
      });
      rentalsCreated++;

      const message = await db.message.create({
        data: {
          rentalId: rental.id,
          direction: 'inbound',
          content: cas.message,
          status: 'pending_approval',
          isTest: true,
        },
      });
      messagesCreated++;

      if (gaClient) {
        try {
          const rentalForMessaging: RentalForMessaging = {
            id: rental.id,
            vehicleId: vehicle.id,
            driverName,
            driverGetaroundId,
            getaroundId: cas.getaroundId,
            startAt: cas.startAt,
            endAt: cas.endAt,
            status: cas.status,
            vehicle: {
              make: vehicle.make,
              model: vehicle.model,
              licensePlate: vehicle.licensePlate,
              parkingZone: vehicle.parkingZone,
              deliveryPointName: vehicle.deliveryPointName,
            },
          };
          await analyzeAndProcessMessage({ id: message.id, content: cas.message }, rentalForMessaging, db, gaClient);
          console.log(`[SeedTestData] Analyse IA déclenchée — cas ${cas.getaroundId}`);
        } catch (e) {
          console.error(`[SeedTestData] Erreur analyse IA cas ${cas.getaroundId}:`, e);
        }
      }

      if (cas.isCarSeat) carSeatRequestsTriggered++;
    }

    // Carkeeper test user — idempotent
    const CARKEEPER_EMAIL = 'carkeeper.test@sunanddrive.fr';
    let carkeeperCreated = 0;
    try {
      const existingCarkeeper = await db.user.findFirst({
        where: { email: CARKEEPER_EMAIL },
        select: { id: true },
      });
      if (!existingCarkeeper) {
        const passwordHash = await hashPassword('CarTest2026!');
        const carkeeper = await db.user.create({
          data: {
            email: CARKEEPER_EMAIL,
            name: 'Carkeeper Test',
            role: 'carkeeper',
            roles: ['carkeeper'],
            passwordHash,
          },
        });
        const vehiclesToAssign = await db.vehicle.findMany({
          where: { getaroundId: { in: ['1472640', '1212044'] } },
          select: { id: true },
        });
        for (const vehicle of vehiclesToAssign) {
          await db.vehicleCarkeeper.upsert({
            where: { vehicleId_userId: { vehicleId: vehicle.id, userId: carkeeper.id } },
            create: { vehicleId: vehicle.id, userId: carkeeper.id },
            update: {},
          });
        }
        carkeeperCreated = 1;
        console.log(`[SeedTestData] Carkeeper créé — ${CARKEEPER_EMAIL}`);
      }
    } catch (e) {
      console.error('[SeedTestData] Erreur création carkeeper:', e);
    }

    res.json({
      rentalsCreated,
      messagesCreated,
      renterCreated: rentalsCreated > 0 ? 1 : 0,
      carSeatRequestsTriggered,
      carkeeperCreated,
    });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/superadmin/test-data?slug=...
router.delete('/test-data', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : undefined;
    if (!slug) { res.status(400).json({ error: 'Query param slug requis' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug },
      select: { tenantDbUrl: true },
    });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);

    const testRentals = await db.rental.findMany({ where: { isTest: true }, select: { id: true } });
    const rentalIds = testRentals.map(r => r.id);

    let deletedMessages = 0;
    let deletedCarSeatRequests = 0;
    let deletedRentals = 0;

    if (rentalIds.length > 0) {
      await db.sequenceExecution.deleteMany({ where: { rentalId: { in: rentalIds } } });
      const msgs = await db.message.deleteMany({ where: { rentalId: { in: rentalIds } } });
      deletedMessages = msgs.count;
      const seats = await db.carSeatRequest.deleteMany({ where: { rentalId: { in: rentalIds } } });
      deletedCarSeatRequests = seats.count;
      const rentals = await db.rental.deleteMany({ where: { id: { in: rentalIds } } });
      deletedRentals = rentals.count;
    }

    // Supprimer le user carkeeper test
    let deletedUsers = 0;
    try {
      const result = await db.user.deleteMany({ where: { email: 'carkeeper.test@sunanddrive.fr' } });
      deletedUsers = result.count;
    } catch (e) {
      console.error('[DeleteTestData] Erreur suppression carkeeper:', e);
    }

    res.json({ success: true, deletedRentals, deletedMessages, deletedCarSeatRequests, deletedUsers });
  } catch (err: unknown) { next(err); }
});

// ─── Plans & Tarifs ───────────────────────────────────────────────────────────

// GET /api/v1/superadmin/plans — retourne les 3 plans, auto-crée les manquants
router.get('/plans', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    let plans = await master.planConfig.findMany({ orderBy: { name: 'asc' } });

    // Auto-créer les plans manquants avec des valeurs par défaut
    const existing = new Set(plans.map(p => p.name));
    const missing = (['starter', 'pro', 'enterprise'] as const).filter(n => !existing.has(n));
    if (missing.length > 0) {
      await master.planConfig.createMany({
        data: missing.map(name => ({ name, priceMonthly: 0, priceYearly: 0, description: '', features: [] })),
        skipDuplicates: true,
      });
      plans = await master.planConfig.findMany({ orderBy: { name: 'asc' } });
    }

    res.json({ plans });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/superadmin/plans/:name
router.put('/plans/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      priceMonthly: z.number().min(0).optional(),
      priceYearly: z.number().min(0).optional(),
      description: z.string().optional(),
      features: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const master = getMasterClient();
    const plan = await master.planConfig.upsert({
      where: { name: req.params.name as string },
      create: {
        name: req.params.name as string,
        priceMonthly: body.data.priceMonthly ?? 0,
        priceYearly: body.data.priceYearly ?? 0,
        description: body.data.description ?? '',
        features: body.data.features ?? [],
        isActive: body.data.isActive ?? true,
      },
      update: {
        ...(body.data.priceMonthly !== undefined ? { priceMonthly: body.data.priceMonthly } : {}),
        ...(body.data.priceYearly !== undefined ? { priceYearly: body.data.priceYearly } : {}),
        ...(body.data.description !== undefined ? { description: body.data.description } : {}),
        ...(body.data.features !== undefined ? { features: body.data.features } : {}),
        ...(body.data.isActive !== undefined ? { isActive: body.data.isActive } : {}),
      },
    });
    res.json({ plan });
  } catch (err: unknown) { next(err); }
});

// ─── Abonnement tenant ────────────────────────────────────────────────────────

// PATCH /api/v1/superadmin/companies/:id/subscription
router.patch('/companies/:id/subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      plan: z.enum(PLANS).optional(),
      mode: z.enum(['standard', 'trial', 'forced']).optional(),
      trialEndsAt: z.string().datetime().nullable().optional(),
      forcedPrice: z.number().nullable().optional(),
      commercialNote: z.string().nullable().optional(),
      status: z.enum(['active', 'suspendu', 'résilié']).optional(),
      subscriptionStartedAt: z.string().datetime().nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const master = getMasterClient();
    const existing = await master.company.findUnique({
      where: { id: req.params.id as string },
      select: { subscriptionStatus: true, contactEmail: true, name: true, plan: true },
    });
    if (!existing) { res.status(404).json({ error: 'Société introuvable' }); return; }

    const data: Record<string, unknown> = {};
    if (body.data.plan !== undefined) data.plan = body.data.plan;
    if (body.data.mode !== undefined) data.subscriptionMode = body.data.mode;
    if (body.data.trialEndsAt !== undefined) data.trialEndsAt = body.data.trialEndsAt ? new Date(body.data.trialEndsAt) : null;
    if (body.data.forcedPrice !== undefined) data.forcedPrice = body.data.forcedPrice;
    if (body.data.commercialNote !== undefined) data.commercialNote = body.data.commercialNote;
    if (body.data.status !== undefined) data.subscriptionStatus = body.data.status;
    if (body.data.subscriptionStartedAt !== undefined) data.subscriptionStartedAt = body.data.subscriptionStartedAt ? new Date(body.data.subscriptionStartedAt) : null;

    const company = await master.company.update({
      where: { id: req.params.id as string },
      data,
      select: { id: true, name: true, plan: true, subscriptionStatus: true, subscriptionMode: true, trialEndsAt: true, forcedPrice: true, commercialNote: true, subscriptionStartedAt: true },
    });

    if (body.data.status && body.data.status !== (existing.subscriptionStatus as string) && existing.contactEmail) {
      const emailMap: Record<string, { subject: string; html: string }> = {
        suspendu: {
          subject: 'Votre accès SunanddriveOS a été suspendu',
          html: `<p>Bonjour,</p><p>Votre accès à SunanddriveOS pour <strong>${existing.name}</strong> a été suspendu. Contactez-nous pour régulariser votre situation : <a href="mailto:contact@sunanddrive.fr">contact@sunanddrive.fr</a></p>`,
        },
        résilié: {
          subject: 'Votre abonnement SunanddriveOS a été résilié',
          html: `<p>Bonjour,</p><p>Votre abonnement SunanddriveOS pour <strong>${existing.name}</strong> a été résilié. Contactez-nous si vous souhaitez reprendre : <a href="mailto:contact@sunanddrive.fr">contact@sunanddrive.fr</a></p>`,
        },
        active: {
          subject: 'Votre accès SunanddriveOS a été réactivé',
          html: `<p>Bonjour,</p><p>Votre accès à SunanddriveOS pour <strong>${existing.name}</strong> a été réactivé. Connectez-vous sur <a href="https://appli.sunanddrive.com">appli.sunanddrive.com</a></p>`,
        },
      };
      const tpl = emailMap[body.data.status];
      if (tpl) {
        try { await sendEmail({ to: existing.contactEmail, subject: tpl.subject, html: tpl.html }); } catch { /* non bloquant */ }
      }
    }

    // Tracker le changement de plan (non bloquant)
    if (body.data.plan && body.data.plan !== existing.plan) {
      master.tenantEvent.create({ data: { companyId: req.params.id as string, module: 'plan', action: `${existing.plan}→${body.data.plan}`, occurredAt: new Date() } }).catch(() => {});
    }

    res.json({ company });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/superadmin/companies/:id/plan-history
router.get('/companies/:id/plan-history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const events = await master.tenantEvent.findMany({
      where: { companyId: req.params.id as string, module: 'plan' },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });
    res.json({ history: events.map(e => ({ id: e.id, change: e.action, at: e.occurredAt })) });
  } catch (err: unknown) { next(err); }
});

// ─── Notes internes ───────────────────────────────────────────────────────────

// GET /api/v1/superadmin/companies/:id/notes
router.get('/companies/:id/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const notes = await master.tenantNote.findMany({
      where: { companyId: req.params.id as string },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ notes });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/companies/:id/notes
router.post('/companies/:id/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ content: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Contenu requis' }); return; }

    const master = getMasterClient();
    const note = await master.tenantNote.create({
      data: { companyId: req.params.id as string, content: body.data.content },
    });
    res.status(201).json({ note });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/superadmin/companies/:id/notes/:noteId
router.delete('/companies/:id/notes/:noteId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    await master.tenantNote.delete({ where: { id: req.params.noteId as string, companyId: req.params.id as string } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// ─── Impersonation ────────────────────────────────────────────────────────────

// POST /api/v1/superadmin/companies/:id/impersonate
router.post('/companies/:id/impersonate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { id: req.params.id as string },
      select: { tenantDbUrl: true, slug: true, plan: true, trialEndsAt: true, stripeSubscriptionId: true },
    });
    if (!company) { res.status(404).json({ error: 'Société introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const adminUser = await db.user.findFirst({
      where: { isActive: true, OR: [{ role: 'admin' }, { roles: { has: 'admin' } }] },
      select: { id: true, name: true, email: true, role: true, roles: true },
    });
    if (!adminUser) { res.status(404).json({ error: 'Aucun admin actif dans cette société' }); return; }

    const jwtSecret = process.env.JWT_SECRET!;
    const token = jwt.sign(
      {
        userId: adminUser.id,
        tenantSlug: company.slug,
        role: adminUser.role,
        roles: adminUser.roles,
        plan: company.plan,
        trialEndsAt: company.trialEndsAt?.toISOString() ?? null,
        hasActiveSubscription: !!company.stripeSubscriptionId,
        impersonated: true,
      },
      jwtSecret,
      { expiresIn: '2h' },
    );

    res.json({ token, slug: company.slug, userName: adminUser.name });
  } catch (err: unknown) { next(err); }
});

// ─── Email superadmin → tenant ────────────────────────────────────────────────

// POST /api/v1/superadmin/companies/:id/send-email
router.post('/companies/:id/send-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      subject: z.string().min(1),
      body: z.string().min(1),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { id: req.params.id as string },
      select: { contactEmail: true, name: true },
    });
    if (!company?.contactEmail) { res.status(400).json({ error: 'Aucun email de contact pour cette société' }); return; }

    await sendEmail({ to: company.contactEmail, subject: body.data.subject, html: `<p>${body.data.body.replace(/\n/g, '<br/>')}</p>` });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// ─── Paiements tenant ─────────────────────────────────────────────────────────

// GET /api/v1/superadmin/companies/:id/payments
router.get('/companies/:id/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const payments = await master.billingEvent.findMany({
      where: {
        companyId: req.params.id as string,
        type: 'invoice.payment_succeeded',
      },
      orderBy: { processedAt: 'desc' },
      take: 50,
      select: { id: true, type: true, stripeEventId: true, processedAt: true, data: true },
    });
    res.json({ payments });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/superadmin/tenants/:slug/cleanup-simulation
router.delete('/tenants/:slug/cleanup-simulation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params as { slug: string };
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug },
      select: { tenantDbUrl: true },
    });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const testRentals = await db.rental.findMany({
      where: { getaroundId: { startsWith: 'test_' } },
      select: { id: true },
    });
    const rentalIds = testRentals.map(r => r.id);

    if (rentalIds.length > 0) {
      await db.message.deleteMany({ where: { rentalId: { in: rentalIds } } });
      await db.rental.deleteMany({ where: { id: { in: rentalIds } } });
    }

    res.json({ success: true, deleted: rentalIds.length });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/superadmin/tenants/:slug/cleanup-maintenance — RAZ entretiens
router.delete('/tenants/:slug/cleanup-maintenance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: (req.params.slug as string) },
      select: { tenantDbUrl: true, name: true },
    });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }
    const db = getTenantClient(company.tenantDbUrl);
    const result = await db.maintenance.deleteMany({});
    console.log(`[Cleanup] ${result.count} entretien(s) supprimé(s) pour ${company.name}`);
    res.json({ success: true, deleted: result.count });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/tenants/:slug/fix-cancelled-rentals — corriger 2 locations annulées connues
router.post('/tenants/:slug/fix-cancelled-rentals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: (req.params.slug as string) },
      select: { tenantDbUrl: true, name: true },
    });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }
    const db = getTenantClient(company.tenantDbUrl);

    const fixes: string[] = [];

    // Tiphaine De Courson — getaroundId 10087414
    const r1 = await db.rental.findFirst({ where: { getaroundId: '10087414' }, select: { id: true, status: true } });
    if (r1) {
      await db.rental.update({ where: { id: r1.id }, data: { status: 'cancelled', cancellationReason: 'annulation_locataire' } });
      fixes.push(`Rental 10087414 (Tiphaine De Courson) → cancelled, annulation_locataire`);
    } else {
      fixes.push('Rental 10087414 introuvable');
    }

    // Erlend Du Réau — getaroundId 10199259
    const r2 = await db.rental.findFirst({ where: { getaroundId: '10199259' }, select: { id: true, status: true } });
    if (r2) {
      await db.rental.update({ where: { id: r2.id }, data: { status: 'cancelled', cancellationReason: 'sans_suite' } });
      fixes.push(`Rental 10199259 (Erlend Du Réau) → cancelled, sans_suite`);
    } else {
      fixes.push('Rental 10199259 introuvable');
    }

    console.log(`[FixCancelledRentals] ${company.name} : ${fixes.join(' | ')}`);
    res.json({ success: true, fixes });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/tenants/:slug/cleanup-test-data
router.post('/tenants/:slug/cleanup-test-data', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params as { slug: string };
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug },
      select: { tenantDbUrl: true, id: true },
    });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const testPattern = { contains: 'playwright', mode: 'insensitive' as const };

    // 1. Coûts véhicule hors coûts récurrents officiels
    const keepLabels = ['Assurance AON', 'Boîtier Connect', 'Parking P3'];
    const costsResult = await db.vehicleCost.deleteMany({
      where: { label: { notIn: keepLabels } },
    });

    // 2. Locations avec nom conducteur playwright ou "Test Playwright"
    const rentalsResult = await db.rental.deleteMany({
      where: {
        OR: [
          { driverName: testPattern },
          { driverName: { contains: 'Test Playwright', mode: 'insensitive' } },
        ],
      },
    });

    // 3. Entretiens dont les notes ou le prestataire contiennent "playwright"
    const maintenanceResult = await db.maintenance.deleteMany({
      where: {
        OR: [
          { notes: testPattern },
          { provider: testPattern },
          { type: testPattern },
        ],
      },
    });

    // 4. MaintenanceTasks dont les notes contiennent "playwright"
    const taskResult = await db.maintenanceTask.deleteMany({
      where: { lastNotes: testPattern },
    });

    // 5. VehicleRatings parasites :
    //    A) notes contient "playwright"
    //    B) keywords contient 'playwright' (insensible casse)
    //    C) period > mois actuel ET reviewCount <= 10 (futur improbable)
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ratingsResult = await db.vehicleRating.deleteMany({
      where: {
        OR: [
          { notes: testPattern },
          { keywords: { has: 'playwright' } },
          {
            AND: [
              { period: { gt: currentPeriod } },
              { reviewCount: { lte: 10 } },
            ],
          },
        ],
      },
    });
    console.log(`[Cleanup] ${ratingsResult.count} VehicleRating parasite(s) supprimé(s)`);

    // 6. Messages dont le contenu contient "playwright"
    const messagesResult = await db.message.deleteMany({
      where: { content: testPattern },
    });

    // 7. Notes NPS dans master DB avec comment playwright
    const npsResult = await master.npsResponse.deleteMany({
      where: {
        companyId: company.id,
        comment: testPattern,
      },
    }).catch(() => ({ count: 0 }));

    res.json({
      success: true,
      costsDeleted: costsResult.count,
      rentalsDeleted: rentalsResult.count,
      maintenanceDeleted: maintenanceResult.count,
      tasksDeleted: taskResult.count,
      ratingsDeleted: ratingsResult.count,
      messagesDeleted: messagesResult.count,
      npsDeleted: npsResult.count,
    });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/superadmin/tenants/:slug/audit-test-data
// Rapport audit des données potentiellement créées par Playwright (createdAt autour d'une date)
router.get('/tenants/:slug/audit-test-data', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params as { slug: string };
    const master = getMasterClient();
    const company = await master.company.findUnique({ where: { slug }, select: { tenantDbUrl: true } });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);

    // Fenêtre temporelle configurable via query (défaut : 14 juin 2026 ± 2 jours)
    const center = req.query.date ? new Date(req.query.date as string) : new Date('2026-06-14T00:00:00Z');
    const windowDays = req.query.days ? parseInt(req.query.days as string) : 2;
    const from = new Date(center.getTime() - windowDays * 86_400_000);
    const to   = new Date(center.getTime() + windowDays * 86_400_000);
    const where = { createdAt: { gte: from, lte: to } };

    const [
      ratings, maintenanceTasks, maintenances, rentals, vehicleCosts,
      incidents, blockings, messages, notifications,
    ] = await Promise.all([
      db.vehicleRating.findMany({ where, select: { id: true, vehicleId: true, period: true, rating: true, reviewCount: true, keywords: true, notes: true, createdAt: true } }),
      db.maintenanceTask.findMany({ where, select: { id: true, vehicleId: true, type: true, lastNotes: true, createdAt: true } }),
      db.maintenance.findMany({ where, select: { id: true, vehicleId: true, type: true, notes: true, provider: true, createdAt: true } }),
      db.rental.findMany({ where, select: { id: true, vehicleId: true, driverName: true, status: true, createdAt: true } }),
      db.vehicleCost.findMany({ where, select: { id: true, vehicleId: true, label: true, amount: true, createdAt: true } }),
      db.incident.findMany({ where, select: { id: true, vehicleId: true, description: true, createdAt: true } }),
      db.blocking.findMany({ where, select: { id: true, vehicleId: true, reason: true, type: true, createdAt: true } }),
      db.message.findMany({ where, select: { id: true, rentalId: true, content: true, direction: true, createdAt: true } }),
      db.notification.findMany({ where, select: { id: true, userId: true, type: true, title: true, createdAt: true } }),
    ]);

    const report = {
      auditWindow: { from, to, centerDate: center },
      counts: {
        vehicleRatings: ratings.length,
        maintenanceTasks: maintenanceTasks.length,
        maintenances: maintenances.length,
        rentals: rentals.length,
        vehicleCosts: vehicleCosts.length,
        incidents: incidents.length,
        blockings: blockings.length,
        messages: messages.length,
        notifications: notifications.length,
      },
      data: { ratings, maintenanceTasks, maintenances, rentals, vehicleCosts, incidents, blockings, messages, notifications },
    };

    console.log(`[Audit] ${slug} — fenêtre ${from.toISOString().slice(0,10)} → ${to.toISOString().slice(0,10)}`);
    console.log('[Audit] Comptes :', report.counts);

    res.json(report);
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/superadmin/tenants/:slug/fix-logo-url
// Corrige l'URL du logo stockée en base (ex: http://192.168.1.x → PUBLIC_URL)
router.post('/tenants/:slug/fix-logo-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params as { slug: string };
    const publicBase = (process.env.PUBLIC_URL ?? process.env.FRONTEND_URL ?? 'https://appli.sunanddrive.com').replace(/\/$/, '');

    const master = getMasterClient();
    const company = await master.company.findUnique({ where: { slug }, select: { tenantDbUrl: true } });
    if (!company) { res.status(404).json({ error: 'Tenant introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const settings = await db.companySettings.findFirst({ select: { id: true, logoUrl: true } });
    if (!settings?.logoUrl) { res.json({ fixed: false, reason: 'Aucun logo en base' }); return; }

    // Réécrit n'importe quel host local / IP privée vers PUBLIC_URL
    const fixed = settings.logoUrl.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?/, publicBase);

    if (fixed === settings.logoUrl) { res.json({ fixed: false, reason: 'URL déjà publique', logoUrl: settings.logoUrl }); return; }

    await db.companySettings.update({ where: { id: settings.id }, data: { logoUrl: fixed } });
    res.json({ fixed: true, before: settings.logoUrl, after: fixed });
  } catch (err: unknown) { next(err); }
});

export default router;

