import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth';
import { getMasterClient, getTenantClient } from '../../prisma/client';
import { hashPassword } from '../auth/auth.service';

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
    const oneMonthAgo = new Date(now.getTime() - 30 * 86_400_000);

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
          tenantEvents: { where: { occurredAt: { gte: sevenDaysAgo } }, take: 1, select: { id: true } },
        },
      }),
    ]);

    const churnRisk = activeCompanies.filter(c => c.tenantEvents.length === 0).length;

    const payouts = await Promise.allSettled(activeCompanies.map(async (c) => {
      const db = getTenantClient(c.tenantDbUrl);
      const agg = await db.rental.aggregate({
        _sum: { ownerPayout: true },
        where: { endAt: { gte: oneMonthAgo } },
      });
      return agg._sum.ownerPayout ?? 0;
    }));
    const mrrTotal = Math.round(payouts.reduce((sum, p) => sum + (p.status === 'fulfilled' ? p.value : 0), 0));

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
      slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug : lettres minuscules, chiffres, tirets uniquement'),
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
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const master = getMasterClient();
    const exists = await master.company.findUnique({ where: { slug: body.data.slug } });
    if (exists) { res.status(409).json({ error: 'Ce slug est déjà utilisé' }); return; }

    const trialEndsAt = body.data.trialDays > 0
      ? new Date(Date.now() + body.data.trialDays * 86_400_000)
      : null;

    const company = await master.company.create({
      data: {
        name: body.data.name,
        slug: body.data.slug,
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
      },
      select: { id: true, name: true, slug: true, plan: true, isActive: true, trialEndsAt: true, createdAt: true },
    });

    res.status(201).json({ company });
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

export default router;
