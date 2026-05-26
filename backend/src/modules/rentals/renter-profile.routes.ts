import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/rentals/renter/:getaroundId/profile
router.get('/renter/:getaroundId/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getaroundId } = req.params as { getaroundId: string };
    const db = getTenantClient(req.tenantDbUrl!);

    const [rentals, blacklistEntry] = await Promise.all([
      db.rental.findMany({
        where: { driverGetaroundId: getaroundId },
        include: {
          vehicle: { select: { licensePlate: true } },
          incidents: { select: { id: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
      db.renterBlacklist.findUnique({ where: { driverGetaroundId: getaroundId } }),
    ]);

    if (rentals.length === 0 && !blacklistEntry) {
      res.status(404).json({ error: 'Locataire introuvable' });
      return;
    }

    const driverName = rentals[0]?.driverName ?? blacklistEntry?.driverName ?? 'Inconnu';
    const totalRentals = rentals.length;
    const totalKm = rentals.reduce((s, r) => s + (r.kmDriven ?? 0), 0);
    const totalRevenue = rentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);
    const incidents = rentals.reduce((s, r) => s + r.incidents.length, 0);
    const plates = [...new Set(rentals.map(r => r.vehicle.licensePlate))];

    const completed = rentals.filter(r => r.status === 'completed');
    const isVip = completed.length >= 5 && completed.every(r => r.incidents.length === 0);

    res.json({
      driverName,
      driverGetaroundId: getaroundId,
      totalRentals,
      totalKm,
      avgKmPerRental: totalRentals > 0 ? Math.round(totalKm / totalRentals) : 0,
      avgRevenue: totalRentals > 0 ? Math.round((totalRevenue / totalRentals) * 100) / 100 : 0,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      incidents,
      isBlacklisted: Boolean(blacklistEntry),
      blacklistReason: blacklistEntry?.reason,
      isVip,
      firstRentalAt: rentals[0]?.startAt ?? null,
      lastRentalAt: rentals[rentals.length - 1]?.startAt ?? null,
      vehicles: plates,
    });
  } catch (err: unknown) { next(err); }
});

export default router;
