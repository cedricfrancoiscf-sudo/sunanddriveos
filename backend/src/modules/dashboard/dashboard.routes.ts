import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

function isoWeek(d: Date): string {
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const year = thursday.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const startOfW1 = new Date(jan4);
  startOfW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const week = Math.floor((thursday.getTime() - startOfW1.getTime()) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function weekStart(d: Date): Date {
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return monday;
}

const MONTHS_FR = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];

function weekLabel(start: Date, end: Date): string {
  const last = new Date(end);
  last.setDate(end.getDate() - 1); // end is exclusive
  if (start.getMonth() === last.getMonth()) {
    return `${start.getDate()}-${last.getDate()} ${MONTHS_FR[last.getMonth()]}`;
  }
  return `${start.getDate()} ${MONTHS_FR[start.getMonth()]}-${last.getDate()} ${MONTHS_FR[last.getMonth()]}`;
}

// GET /api/v1/dashboard/occupancy
// 4 forward-looking weeks: current week + 3 next weeks
router.get('/occupancy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();

    // Build 4 week windows starting from current week (Monday of today)
    const weeks: Array<{ weekKey: string; label: string; start: Date; end: Date }> = [];
    const baseMonday = weekStart(now);
    for (let delta = 0; delta < 4; delta++) {
      const start = new Date(baseMonday);
      start.setDate(baseMonday.getDate() + delta * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      const weekKey = isoWeek(start);
      weeks.push({ weekKey, label: weekLabel(start, end), start, end });
    }

    const rangeStart = weeks[0]!.start;
    const rangeEnd = weeks[weeks.length - 1]!.end;

    const [vehicles, rentals] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, make: true, model: true, licensePlate: true },
        orderBy: { licensePlate: 'asc' },
      }),
      db.rental.findMany({
        where: {
          status: { in: ['booked', 'active'] },
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        select: { vehicleId: true, startAt: true, endAt: true },
      }),
    ]);

    function daysOverlap(start: Date, end: Date, wStart: Date, wEnd: Date): number {
      const s = Math.max(start.getTime(), wStart.getTime());
      const e = Math.min(end.getTime(), wEnd.getTime());
      if (e <= s) return 0;
      return Math.ceil((e - s) / 86_400_000);
    }

    // For each vehicle, compute average occupancy across 4 weeks to sort
    const vehicleAvgOccupancy = vehicles.map(v => {
      const vehicleRentals = rentals.filter(r => r.vehicleId === v.id);
      let totalPct = 0;
      for (const w of weeks) {
        const days = vehicleRentals.reduce((sum, r) =>
          sum + daysOverlap(new Date(r.startAt), new Date(r.endAt), w.start, w.end), 0);
        totalPct += Math.round(Math.min(days, 7) / 7 * 100);
      }
      return { ...v, avg: totalPct / weeks.length };
    });

    vehicleAvgOccupancy.sort((a, b) => b.avg - a.avg);

    const result = weeks.map(w => {
      const vehicleOccupancies = vehicleAvgOccupancy.map(v => {
        const vehicleRentals = rentals.filter(r => r.vehicleId === v.id);
        const days = vehicleRentals.reduce((sum, r) =>
          sum + daysOverlap(new Date(r.startAt), new Date(r.endAt), w.start, w.end), 0);
        const occupancy = Math.round(Math.min(days, 7) / 7 * 100);
        return { id: v.id, name: `${v.make} ${v.model} · ${v.licensePlate}`, occupancy };
      });

      const globalOccupancy = vehicleOccupancies.length > 0
        ? Math.round(vehicleOccupancies.reduce((s, v) => s + v.occupancy, 0) / vehicleOccupancies.length)
        : 0;

      return { week: w.weekKey, label: w.label, vehicles: vehicleOccupancies, globalOccupancy };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
