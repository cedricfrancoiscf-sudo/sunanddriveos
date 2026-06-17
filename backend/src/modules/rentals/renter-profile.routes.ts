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

    const [rentals, blacklistEntry, settings] = await Promise.all([
      db.rental.findMany({
        where: { driverGetaroundId: getaroundId },
        select: {
          id: true,
          driverName: true,
          startAt: true,
          endAt: true,
          status: true,
          kmDriven: true,
          ownerPayout: true,
          grossRevenue: true,
          evaluationRating: true,
          lateReturnFee: true,
          damageCompensation: true,
          gasRefillFee: true,
          driverMessFee: true,
          evaluationFlag: true,
          evaluationFlagAmount: true,
          evaluationFlagUnblockedAt: true,
          vehicle: { select: { licensePlate: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
      db.renterBlacklist.findUnique({ where: { driverGetaroundId: getaroundId } }),
      db.companySettings.findFirst({ select: { invoiceMalusConfig: true } }),
    ]);

    if (rentals.length === 0 && !blacklistEntry) {
      res.status(404).json({ error: 'Locataire introuvable' });
      return;
    }

    const driverName = rentals[0]?.driverName ?? blacklistEntry?.driverName ?? 'Inconnu';

    // Exclure les annulées des statistiques (elles restent dans l'historique)
    const activeRentals = rentals.filter(r => r.status !== 'cancelled');
    const totalRentals = activeRentals.length;
    const totalKm = activeRentals.reduce((s, r) => s + (r.kmDriven ?? 0), 0);
    const totalRevenue = activeRentals.reduce((s, r) => {
      const ca = (r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : Math.max(0, r.grossRevenue ?? 0);
      return s + ca;
    }, 0);

    // Incidents = lateReturnFee OU damageCompensation > 0 (hors annulées)
    const nbIncidents = activeRentals.filter(r => (r.lateReturnFee ?? 0) > 0 || (r.damageCompensation ?? 0) > 0).length;

    const ratedRentals = activeRentals.filter(r => r.evaluationRating !== null);
    const avgRating = ratedRentals.length > 0
      ? Math.round((ratedRentals.reduce((s, r) => s + (r.evaluationRating ?? 0), 0) / ratedRentals.length) * 10) / 10
      : null;

    const plates = [...new Set(rentals.map(r => r.vehicle.licensePlate))];
    const completed = activeRentals.filter(r => r.status === 'completed');
    const isVip = completed.length >= 5 && nbIncidents === 0 && (avgRating === null || avgRating >= 4.5);

    const DEFAULT_MALUS: Record<string, number> = {
      blocked_cleaning: 10, blocked_damage: 20, blocked_claim: 20,
      blocked_late: 5, blocked_infraction: 5, blocked_gas: 5,
    };
    const malusConfig: Record<string, number> =
      settings?.invoiceMalusConfig && typeof settings.invoiceMalusConfig === 'object' && !Array.isArray(settings.invoiceMalusConfig)
        ? settings.invoiceMalusConfig as Record<string, number>
        : {};

    const incidentsFinanciers = activeRentals
      .filter(r => r.evaluationFlag && !r.evaluationFlagUnblockedAt)
      .map(r => ({
        rentalId: r.id,
        startAt: r.startAt,
        flag: r.evaluationFlag!,
        amountEuros: r.evaluationFlagAmount != null ? Math.round(r.evaluationFlagAmount / 100 * 100) / 100 : null,
      }));

    const malusTotal = incidentsFinanciers.reduce((s, inc) => {
      return s + (malusConfig[inc.flag] ?? DEFAULT_MALUS[inc.flag] ?? 5);
    }, 0);

    const rentalHistory = [...rentals]
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
      .map(r => {
        const ca = (r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : Math.max(0, r.grossRevenue ?? 0);
        return {
          id: r.id,
          vehicleLicensePlate: r.vehicle.licensePlate,
          startAt: r.startAt,
          endAt: r.endAt,
          status: r.status,
          kmDriven: r.kmDriven,
          ca: Math.round(ca * 100) / 100,
          evaluationRating: r.evaluationRating,
          lateReturnFee: r.lateReturnFee,
          damageCompensation: r.damageCompensation,
          gasRefillFee: r.gasRefillFee,
          driverMessFee: r.driverMessFee,
          evaluationFlag: r.evaluationFlag,
          evaluationFlagAmount: r.evaluationFlagAmount,
          evaluationFlagUnblockedAt: r.evaluationFlagUnblockedAt,
        };
      });

    res.json({
      driverName,
      driverGetaroundId: getaroundId,
      totalRentals,
      totalKm,
      avgKmPerRental: totalRentals > 0 ? Math.round(totalKm / totalRentals) : 0,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgRevenue: totalRentals > 0 ? Math.round((totalRevenue / totalRentals) * 100) / 100 : 0,
      avgRating,
      nbIncidents,
      isBlacklisted: Boolean(blacklistEntry),
      blacklistReason: blacklistEntry?.reason,
      isVip,
      firstRentalAt: rentals[0]?.startAt ?? null,
      lastRentalAt: rentalHistory[0]?.startAt ?? null,
      vehicles: plates,
      rentals: rentalHistory,
      incidentsFinanciers,
      malusTotal,
    });
  } catch (err: unknown) { next(err); }
});

export default router;
