import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import { hashPassword } from '../auth/auth.service';

const router = Router();
router.use(requireAuth, resolveTenant);

const contractSchema = z.object({
  ownerSharePercent: z.number().min(0).max(100).default(70),
  notes: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
}).default({});

const paymentSchema = z.object({
  iban: z.string().optional(),
  bankName: z.string().optional(),
  paymentDay: z.number().int().min(1).max(31).optional(),
  notes: z.string().optional(),
}).default({});

// GET /api/v1/third-party-owners
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);

    const owners = await db.thirdPartyOwner.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true } },
        vehicles: {
          where: { isActive: true },
          select: { id: true, make: true, model: true, licensePlate: true, healthScore: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Calcule le CA total par propriétaire
    const ownersWithStats = await Promise.all(owners.map(async (owner) => {
      const vehicleIds = owner.vehicles.map(v => v.id);
      if (vehicleIds.length === 0) {
        return { ...owner, totalRevenue: 0, totalOwnerPayout: 0, rentalCount: 0 };
      }
      const agg = await db.rental.aggregate({
        where: { vehicleId: { in: vehicleIds }, status: 'completed' },
        _sum: { ownerPayout: true, grossRevenue: true },
        _count: { id: true },
      });
      const contract = contractSchema.safeParse(owner.contractDetails);
      const sharePercent = contract.success ? contract.data.ownerSharePercent : 70;
      const ownerPayout = agg._sum.ownerPayout ?? 0;
      return {
        ...owner,
        totalRevenue: Math.round((agg._sum.grossRevenue ?? 0) * 100) / 100,
        totalOwnerPayout: Math.round(ownerPayout * sharePercent / 100 * 100) / 100,
        rentalCount: agg._count.id,
      };
    }));

    res.json({ owners: ownersWithStats });
  } catch (err) { next(err); }
});

// GET /api/v1/third-party-owners/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const owner = await db.thirdPartyOwner.findUnique({
      where: { id: (req.params.id as string) },
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true } },
        vehicles: {
          select: {
            id: true, make: true, model: true, licensePlate: true, year: true,
            color: true, healthScore: true, currentMileage: true, isActive: true, photoUrl: true,
          },
        },
      },
    });
    if (!owner) { res.status(404).json({ error: 'Propriétaire introuvable' }); return; }
    res.json({ owner });
  } catch (err) { next(err); }
});

// POST /api/v1/third-party-owners — crée User (role third_party_owner) + ThirdPartyOwner
router.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      contractDetails: contractSchema,
      paymentDetails: paymentSchema,
      password: z.string().min(8).optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.user.findUnique({ where: { email: body.data.email } });
    if (existing) { res.status(409).json({ error: 'Email déjà utilisé' }); return; }

    // Crée l'utilisateur avec invitation ou mot de passe direct
    let passwordHash: string | undefined;
    let invitationToken: string | undefined;
    let invitationExpiry: Date | undefined;

    if (body.data.password) {
      passwordHash = await hashPassword(body.data.password);
    } else {
      invitationToken = crypto.randomBytes(32).toString('hex');
      invitationExpiry = new Date(Date.now() + 30 * 86_400_000); // 30 jours
    }

    const user = await db.user.create({
      data: {
        email: body.data.email.toLowerCase(),
        name: body.data.name,
        role: 'third_party_owner',
        passwordHash,
        invitationToken,
        invitationExpiry,
        isActive: Boolean(passwordHash),
      },
    });

    const owner = await db.thirdPartyOwner.create({
      data: {
        userId: user.id,
        name: body.data.name,
        email: body.data.email.toLowerCase(),
        phone: body.data.phone,
        contractDetails: body.data.contractDetails,
        paymentDetails: body.data.paymentDetails,
      },
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true } },
        vehicles: true,
      },
    });

    const inviteUrl = invitationToken
      ? `${process.env.FRONTEND_URL}/accept-invitation?token=${invitationToken}&slug=${req.auth!.tenantSlug}`
      : undefined;

    res.status(201).json({ owner, inviteUrl });
  } catch (err) { next(err); }
});

// PUT /api/v1/third-party-owners/:id
router.put('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().nullable().optional(),
      contractDetails: z.record(z.unknown()).optional(),
      paymentDetails: z.record(z.unknown()).optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const owner = await db.thirdPartyOwner.findUnique({ where: { id: (req.params.id as string) } });
    if (!owner) { res.status(404).json({ error: 'Propriétaire introuvable' }); return; }

    const updated = await db.thirdPartyOwner.update({
      where: { id: (req.params.id as string) },
      data: {
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.email !== undefined ? { email: body.data.email } : {}),
        ...(body.data.phone !== undefined ? { phone: body.data.phone } : {}),
        ...(body.data.contractDetails !== undefined ? { contractDetails: body.data.contractDetails as never } : {}),
        ...(body.data.paymentDetails !== undefined ? { paymentDetails: body.data.paymentDetails as never } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true } },
        vehicles: { select: { id: true, make: true, model: true, licensePlate: true } },
      },
    });

    // Sync nom/email sur le User lié si modifiés
    if (body.data.name || body.data.email) {
      await db.user.update({
        where: { id: owner.userId },
        data: {
          ...(body.data.name ? { name: body.data.name } : {}),
          ...(body.data.email ? { email: body.data.email } : {}),
        },
      });
    }

    res.json({ owner: updated });
  } catch (err) { next(err); }
});

// GET /api/v1/third-party-owners/:id/statement?from=&to=
// Relevé de revenus sur une période donnée
router.get('/:id/statement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const owner = await db.thirdPartyOwner.findUnique({
      where: { id: (req.params.id as string) },
      include: { vehicles: { select: { id: true, make: true, model: true, licensePlate: true } } },
    });
    if (!owner) { res.status(404).json({ error: 'Propriétaire introuvable' }); return; }

    const from = req.query.from ? new Date(req.query.from as string) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();

    const vehicleIds = owner.vehicles.map(v => v.id);
    if (vehicleIds.length === 0) {
      res.json({ owner: { id: owner.id, name: owner.name }, period: { from, to }, lines: [], totals: { grossRevenue: 0, ownerPayout: 0, ownerShare: 0 } });
      return;
    }

    const contract = contractSchema.safeParse(owner.contractDetails);
    const sharePercent = contract.success ? contract.data.ownerSharePercent : 70;

    const rentals = await db.rental.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        status: 'completed',
        endAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        vehicleId: true,
        driverName: true,
        startAt: true,
        endAt: true,
        kmDriven: true,
        grossRevenue: true,
        ownerPayout: true,
        damageCompensation: true,
        lateReturnFee: true,
        gasRefillFee: true,
        vehicle: { select: { make: true, model: true, licensePlate: true } },
      },
      orderBy: { endAt: 'asc' },
    });

    const lines = rentals.map(r => {
      const ownerPayout = r.ownerPayout ?? 0;
      const ownerShare = Math.round(ownerPayout * sharePercent / 100 * 100) / 100;
      return {
        rentalId: r.id,
        vehicle: r.vehicle,
        driverName: r.driverName,
        startAt: r.startAt,
        endAt: r.endAt,
        kmDriven: r.kmDriven,
        grossRevenue: r.grossRevenue ?? 0,
        ownerPayout,
        ownerShare,
        damageCompensation: r.damageCompensation ?? 0,
        lateReturnFee: r.lateReturnFee ?? 0,
        gasRefillFee: r.gasRefillFee ?? 0,
      };
    });

    const totals = {
      grossRevenue: Math.round(lines.reduce((s, l) => s + l.grossRevenue, 0) * 100) / 100,
      ownerPayout: Math.round(lines.reduce((s, l) => s + l.ownerPayout, 0) * 100) / 100,
      ownerShare: Math.round(lines.reduce((s, l) => s + l.ownerShare, 0) * 100) / 100,
      rentalCount: lines.length,
      totalKm: lines.reduce((s, l) => s + (l.kmDriven ?? 0), 0),
    };

    res.json({
      owner: { id: owner.id, name: owner.name, email: owner.email, sharePercent },
      period: { from: from.toISOString(), to: to.toISOString() },
      vehicles: owner.vehicles,
      lines,
      totals,
    });
  } catch (err) { next(err); }
});

// PUT /api/v1/third-party-owners/:id/vehicles — assigner véhicules au propriétaire
router.put('/:id/vehicles', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      vehicleIds: z.array(z.string()),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const owner = await db.thirdPartyOwner.findUnique({ where: { id: (req.params.id as string) } });
    if (!owner) { res.status(404).json({ error: 'Propriétaire introuvable' }); return; }

    // Désassigne tous les véhicules actuels de ce propriétaire
    await db.vehicle.updateMany({
      where: { thirdPartyOwnerId: (req.params.id as string) },
      data: { thirdPartyOwnerId: null },
    });
    // Assigne les nouveaux
    if (body.data.vehicleIds.length > 0) {
      await db.vehicle.updateMany({
        where: { id: { in: body.data.vehicleIds } },
        data: { thirdPartyOwnerId: (req.params.id as string) },
      });
    }

    const updated = await db.thirdPartyOwner.findUnique({
      where: { id: (req.params.id as string) },
      include: { vehicles: { select: { id: true, make: true, model: true, licensePlate: true } } },
    });

    res.json({ owner: updated });
  } catch (err) { next(err); }
});

export default router;
