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
    const [total, active, onTrial, perPlan] = await Promise.all([
      master.company.count(),
      master.company.count({ where: { isActive: true } }),
      master.company.count({ where: { isActive: true, trialEndsAt: { gte: new Date() } } }),
      master.company.groupBy({ by: ['plan'], _count: { id: true } }),
    ]);

    res.json({
      stats: {
        total,
        active,
        inactive: total - active,
        onTrial,
        perPlan: Object.fromEntries(perPlan.map(p => [p.plan, p._count.id])),
      },
    });
  } catch (err: unknown) { next(err); }
});

// ─── Sociétés (tenants) ────────────────────────────────────────────────────────

// GET /api/v1/superadmin/companies
router.get('/companies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      select: {
        id: true, name: true, slug: true, logoUrl: true, primaryColor: true,
        plan: true, isActive: true, trialEndsAt: true, createdAt: true, updatedAt: true,
        stripeCustomerId: true, stripeSubscriptionId: true,
        _count: { select: { billingEvents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Récupère les stats tenant pour chaque société (nb users, véhicules)
    const companiesWithStats = await Promise.all(companies.map(async (c) => {
      try {
        const fullCompany = await master.company.findUnique({
          where: { id: c.id },
          select: { tenantDbUrl: true },
        });
        if (!fullCompany?.tenantDbUrl) return { ...c, tenantStats: null };

        const db = getTenantClient(fullCompany.tenantDbUrl);
        const [userCount, vehicleCount, rentalCount] = await Promise.all([
          db.user.count({ where: { isActive: true } }),
          db.vehicle.count({ where: { isActive: true } }),
          db.rental.count({ where: { status: 'completed' } }),
        ]);
        return { ...c, tenantStats: { userCount, vehicleCount, rentalCount } };
      } catch {
        return { ...c, tenantStats: null };
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
