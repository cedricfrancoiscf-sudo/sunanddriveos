import { Router, type Request, type Response, type NextFunction } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, isOnlyCarkeeper, getCarekeeperVehicleIds } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient, getMasterClient } from '../../prisma/client';
import { getTaskAlerts } from '../maintenance/maintenance.service';
import { getRentalStats } from '../rentals/rentals.service';

const copilotCache = new Map<string, { text: string; ts: number }>();

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

// GET /api/v1/dashboard/copilot
router.get('/copilot', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantSlug = req.auth!.tenantSlug;
    const cacheKey = `copilot:${tenantSlug}`;
    const cached = copilotCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 3_600_000) {
      res.json({ text: cached.text });
      return;
    }

    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: tenantSlug },
      select: { name: true },
    });

    const [stats, activeCount, todayDepartCount, todayReturnCount, taskAlerts, unansweredCount] = await Promise.all([
      getRentalStats(db, startOfMonth, endOfMonth),
      db.rental.count({ where: { status: 'active' } }),
      db.rental.count({ where: { startAt: { gte: startOfDay, lt: endOfDay }, status: { in: ['booked', 'active'] } } }),
      db.rental.count({ where: { endAt: { gte: startOfDay, lt: endOfDay }, status: { in: ['active', 'completed'] } } }),
      getTaskAlerts(db),
      db.message.count({
        where: { direction: 'inbound', createdAt: { lt: new Date(Date.now() - 12 * 3_600_000) }, rental: { status: { in: ['active', 'booked'] } } },
      }),
    ]);

    const caEncaisse = stats.totalEncaisse;
    const caPrevisionnel = stats.totalPrevisionnel;
    const occupancyRate = stats.occupancyRate;
    const vehicleCount = stats.vehicleCount;

    const alertCount = taskAlerts.length + (unansweredCount > 0 ? 1 : 0);

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'Copilote non disponible' });
      return;
    }

    const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const fmtEur = (v: number) => v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

    const client = new Anthropic();
    const aiResponse = await Promise.race([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `Tu es le copilote de ${company?.name ?? 'votre flotte'}, opérateur Getaround. Réponds en 3-4 phrases courtes, ton professionnel et direct. Pas de formule de politesse.`,
        messages: [{
          role: 'user',
          content: `Données du jour ${dateLabel} :\nCA mois : ${fmtEur(caEncaisse)} encaissé + ${fmtEur(caPrevisionnel)} prévu\nTaux occupation : ${occupancyRate}%\nLocations actives : ${activeCount}\nDéparts aujourd'hui : ${todayDepartCount}\nRetours aujourd'hui : ${todayReturnCount}\nAlertes : ${alertCount} (CT, entretiens, messages)\nGénère le résumé opérationnel du jour.`,
        }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15_000)),
    ]);

    const text = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
    copilotCache.set(cacheKey, { text, ts: Date.now() });
    res.json({ text });
  } catch (err) {
    if (err instanceof Error && err.message === 'Timeout') {
      res.status(504).json({ error: 'Timeout' });
      return;
    }
    next(err);
  }
});

// GET /api/v1/dashboard/maintenances — alertes tâches (source de vérité : MaintenanceTask)
router.get('/maintenances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    let vehicleIds: string[] | undefined;
    if (isOnlyCarkeeper(req.auth)) {
      vehicleIds = await getCarekeeperVehicleIds(db, req.auth!.userId!);
    }
    const maintenances = await getTaskAlerts(db, vehicleIds);
    res.json({ maintenances, count: maintenances.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/n1
// Même période N-1 : caNet, tauxOccupation, nbLocations
router.get('/n1', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const n1Start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const n1End = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0, 23, 59, 59);

    const [rentals, vehicleCount] = await Promise.all([
      db.rental.findMany({
        where: { startAt: { gte: n1Start }, endAt: { lte: n1End }, status: { in: ['completed', 'active', 'booked'] } },
        select: { ownerPayout: true, grossRevenue: true, vehicleId: true, startAt: true, endAt: true },
      }),
      db.vehicle.count({ where: { isActive: true } }),
    ]);

    const caNet = rentals.reduce((s, r) => {
      const payout = (r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : Math.max(0, r.grossRevenue ?? 0);
      return s + payout;
    }, 0);

    const nbLocations = rentals.length;

    let tauxOccupation = 0;
    if (vehicleCount > 0 && rentals.length > 0) {
      const totalDaysInMonth = n1End.getDate();
      const totalSlots = vehicleCount * totalDaysInMonth;
      let occupiedDays = 0;
      for (const r of rentals) {
        const s = Math.max(new Date(r.startAt).getTime(), n1Start.getTime());
        const e = Math.min(new Date(r.endAt).getTime(), n1End.getTime());
        occupiedDays += Math.max(0, Math.ceil((e - s) / 86_400_000));
      }
      tauxOccupation = Math.round(Math.min(occupiedDays / totalSlots, 1) * 100);
    }

    res.json({ caNet: Math.round(caNet * 100) / 100, tauxOccupation, nbLocations, period: { from: n1Start, to: n1End } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/today — bandeau quotidien
router.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

    const [vehicleCount, departs, retours, actives, carSeatRequests] = await Promise.all([
      db.vehicle.count({ where: { isActive: true } }),
      db.rental.count({ where: { startAt: { gte: startOfDay, lt: endOfDay }, status: { in: ['active', 'booked'] } } }),
      db.rental.count({ where: { endAt: { gte: startOfDay, lt: endOfDay }, status: { in: ['active', 'completed'] } } }),
      db.rental.count({ where: { status: 'active' } }),
      db.carSeatRequest.findMany({
        where: {
          status: { in: ['pending', 'confirmed'] },
          rental: { startAt: { gte: startOfDay, lt: endOfDay }, status: { in: ['active', 'booked'] } },
        },
        include: {
          rental: {
            select: { startAt: true, driverName: true, vehicle: { select: { licensePlate: true } } },
          },
        },
      }),
    ]);

    const disponibles = Math.max(0, vehicleCount - actives);
    const accessoiresJour = carSeatRequests.map(r => ({
      type: 'car_seat',
      locataire: r.rental.driverName,
      plaque: r.rental.vehicle.licensePlate,
      heure: new Date(r.rental.startAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
    }));

    res.json({ departs, retours, actives, disponibles, vehicleCount, accessoiresJour });
  } catch (err) { next(err); }
});

// GET /api/v1/dashboard/pipeline — pipeline 28 jours glissants
router.get('/pipeline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const end28 = new Date(Date.now() + 28 * 86_400_000);

    const [vehicles, rentals] = await Promise.all([
      db.vehicle.count({ where: { isActive: true } }),
      db.rental.findMany({
        where: { status: 'booked', startAt: { lte: end28 }, endAt: { gte: now } },
        select: { grossRevenue: true, ownerPayout: true, startAt: true, endAt: true },
      }),
    ]);

    const caReserve = rentals.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : Math.max(0, r.grossRevenue ?? 0)), 0);

    // Calcul jours réservés sur les 28j
    let joursReserves = 0;
    for (const r of rentals) {
      const s = Math.max(now.getTime(), new Date(r.startAt).getTime());
      const e = Math.min(end28.getTime(), new Date(r.endAt).getTime());
      if (e > s) joursReserves += (e - s) / 86_400_000;
    }
    const occupationProjetee = vehicles > 0
      ? Math.round((joursReserves / (vehicles * 28)) * 100)
      : 0;

    // 4 semaines
    const parSemaine = [0, 1, 2, 3].map(w => {
      const wStart = new Date(now.getTime() + w * 7 * 86_400_000);
      const wEnd = new Date(wStart.getTime() + 7 * 86_400_000);
      const wRentals = rentals.filter(r => {
        const s = new Date(r.startAt);
        return s >= wStart && s < wEnd;
      });
      return {
        label: `Sem. ${w + 1}`,
        rentalCount: wRentals.length,
        caEstime: Math.round(wRentals.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : Math.max(0, r.grossRevenue ?? 0)), 0) * 100) / 100,
      };
    });

    res.json({
      caReserve: Math.round(caReserve * 100) / 100,
      nbLocations: rentals.length,
      occupationProjetee,
      parSemaine,
    });
  } catch (err) { next(err); }
});

// GET /api/v1/dashboard/underutilized — véhicules sous-utilisés
router.get('/underutilized', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const past28Start = new Date(now.getTime() - 28 * 86_400_000);
    const next28End = new Date(now.getTime() + 28 * 86_400_000);

    const [vehicles, pastRentals, futureRentals] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, licensePlate: true, make: true, model: true, parkingZone: true },
      }),
      db.rental.findMany({
        where: { startAt: { gte: past28Start, lt: now }, status: { in: ['completed', 'active'] } },
        select: { vehicleId: true },
      }),
      db.rental.findMany({
        where: { startAt: { gte: now, lt: next28End }, status: { in: ['booked', 'active'] } },
        select: { vehicleId: true },
      }),
    ]);

    const result = vehicles.map(v => {
      const past28Count = pastRentals.filter(r => r.vehicleId === v.id).length;
      const next28Count = futureRentals.filter(r => r.vehicleId === v.id).length;
      const ecartPct = past28Count > 0 ? ((next28Count - past28Count) / past28Count) * 100 : (next28Count > 0 ? 100 : 0);
      return {
        vehicleId: v.id,
        plate: v.licensePlate,
        make: v.make,
        model: v.model,
        zone: v.parkingZone ?? 'Non définie',
        next28Count,
        past28Count,
        ecartPct: Math.round(ecartPct),
        isUnderUtilized: ecartPct < -40 && past28Count > 0,
      };
    });

    const avgNext28 = result.length > 0 ? result.reduce((s, v) => s + v.next28Count, 0) / result.length : 0;
    const sorted = [...result].sort((a, b) => b.next28Count - a.next28Count);
    const bestPerformer = sorted[0] && sorted[0].next28Count > 0 ? { plate: sorted[0].plate, next28Count: sorted[0].next28Count } : null;

    res.json({ vehicles: result, avgNext28: Math.round(avgNext28 * 10) / 10, bestPerformer });
  } catch (err) { next(err); }
});

export default router;
