import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/renters
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);

    const [rentals, blacklist] = await Promise.all([
      db.rental.findMany({
        where: { status: { in: ['completed', 'active', 'booked'] }, driverGetaroundId: { not: null } },
        select: {
          driverGetaroundId: true,
          driverName: true,
          ownerPayout: true,
          grossRevenue: true,
          kmDriven: true,
          endAt: true,
          evaluationRating: true,
        },
        orderBy: { endAt: 'desc' },
      }),
      db.renterBlacklist.findMany({ select: { driverGetaroundId: true } }),
    ]);

    const blacklistedIds = new Set(blacklist.map(b => b.driverGetaroundId));

    type RenterData = {
      name: string;
      rentalCount: number;
      ca: number;
      km: number;
      lastRentalAt: Date;
      ratingSum: number;
      ratingCount: number;
    };

    const map = new Map<string, RenterData>();

    for (const r of rentals) {
      const id = r.driverGetaroundId!;
      const ca = (r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : Math.max(0, r.grossRevenue ?? 0);
      const existing = map.get(id);
      if (!existing) {
        map.set(id, {
          name: r.driverName,
          rentalCount: 1,
          ca,
          km: r.kmDriven ?? 0,
          lastRentalAt: new Date(r.endAt),
          ratingSum: r.evaluationRating ?? 0,
          ratingCount: r.evaluationRating ? 1 : 0,
        });
      } else {
        existing.rentalCount++;
        existing.ca += ca;
        existing.km += r.kmDriven ?? 0;
        if (new Date(r.endAt) > existing.lastRentalAt) existing.lastRentalAt = new Date(r.endAt);
        if (r.evaluationRating) { existing.ratingSum += r.evaluationRating; existing.ratingCount++; }
      }
    }

    const renters = Array.from(map.entries())
      .map(([id, d]) => ({
        driverGetaroundId: id,
        name: d.name,
        rentalCount: d.rentalCount,
        totalCA: Math.round(d.ca * 100) / 100,
        totalKm: d.km,
        lastRentalAt: d.lastRentalAt,
        avgRating: d.ratingCount > 0 ? Math.round((d.ratingSum / d.ratingCount) * 10) / 10 : null,
        isBlacklisted: blacklistedIds.has(id),
        isVip: d.rentalCount >= 5 && !blacklistedIds.has(id),
      }))
      .sort((a, b) => b.totalCA - a.totalCA);

    res.json({ renters, total: renters.length });
  } catch (err) { next(err); }
});

export default router;
