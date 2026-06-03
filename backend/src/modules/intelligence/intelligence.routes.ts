import { Router, type Request, type Response, type NextFunction } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import reportRouter from './report.routes';
import { getEffectivePayout } from '../../utils/revenue';

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

// GET /api/v1/intelligence/kpis
router.get('/kpis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const [currentRentals, prevRentals, vehicles, pendingMaints, expiringCTs] = await Promise.all([
      db.rental.findMany({
        where: { startAt: { gte: monthStart }, status: { in: ['booked', 'active', 'completed'] } },
        select: {
          vehicleId: true, startAt: true, endAt: true,
          grossRevenue: true, ownerPayout: true, insuranceFee: true, kmDriven: true,
          gasRefillFee: true, lateReturnFee: true, driverMessFee: true, damageCompensation: true,
        },
      }),
      db.rental.findMany({
        where: { startAt: { gte: prevMonthStart, lte: prevMonthEnd }, status: { in: ['booked', 'active', 'completed'] } },
        select: { grossRevenue: true, ownerPayout: true, vehicleId: true },
      }),
      db.vehicle.findMany({ where: { isActive: true }, select: { id: true, healthScore: true } }),
      db.maintenance.count({ where: { nextServiceDate: { not: null, lte: now } } }),
      db.technicalControl.count({ where: { expiryAt: { gte: now, lte: thirtyDaysFromNow } } }),
    ]);

    // Clamp négatifs — protection contre refunds/annulations mal comptabilisés
    const safeAmt = (v: number | null | undefined): number => Math.max(0, v ?? 0);
    const sum = (arr: Array<number | null | undefined>): number => arr.reduce<number>((s, v) => s + safeAmt(v), 0);

    // Distinction encaissé (ownerPayout > 0 sur completed) vs prévisionnel (booked/active)
    const encaisseRentals = currentRentals.filter(r => {
      // ownerPayout > 0 = virement reçu
      return (r.ownerPayout ?? 0) > 0;
    });
    const previsionnelRentals = currentRentals.filter(r => (r.ownerPayout ?? 0) <= 0);
    const ownerPayoutEncaisse   = sum(encaisseRentals.map(r => r.ownerPayout));
    const ownerPayoutPrevisionnel = sum(previsionnelRentals.map(r => r.grossRevenue)) * 0.70;

    const ownerPayout = sum(currentRentals.map(r => r.ownerPayout)) +
      // Locations sans payout : estimer à 70% grossRevenue
      previsionnelRentals.reduce((s, r) => s + safeAmt(r.grossRevenue) * 0.70, 0);
    const grossRevenue = sum(currentRentals.map(r => r.grossRevenue));
    const insuranceFee = sum(currentRentals.map(r => r.insuranceFee));
    const rentalCount = currentRentals.length;
    const prevPayout = sum(prevRentals.map(r => r.ownerPayout));
    const prevGross = sum(prevRentals.map(r => r.grossRevenue));
    const prevCount = prevRentals.length;

    const totalRentalDays = currentRentals.reduce((s, r) => {
      return s + Math.max(0, (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000);
    }, 0);
    const vehicleCount = vehicles.length;
    const occupancyRate = vehicleCount > 0 && daysInMonth > 0
      ? Math.round((totalRentalDays / (vehicleCount * daysInMonth)) * 100) : 0;

    const avgDuration = rentalCount > 0
      ? currentRentals.reduce((s, r) =>
          s + (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000, 0) / rentalCount : 0;

    const totalKm = sum(currentRentals.map(r => r.kmDriven));
    const avgKmPerRental = rentalCount > 0 ? totalKm / rentalCount : 0;
    const revpar = vehicleCount > 0 && daysInMonth > 0 ? ownerPayout / (vehicleCount * daysInMonth) : 0;

    const withExtra = currentRentals.filter(r =>
      (r.gasRefillFee ?? 0) > 0 || (r.lateReturnFee ?? 0) > 0 ||
      (r.driverMessFee ?? 0) > 0 || (r.damageCompensation ?? 0) > 0
    ).length;
    const extraFeesRate = rentalCount > 0 ? Math.round((withExtra / rentalCount) * 100) : 0;

    const fleetHealthScore = vehicleCount > 0
      ? Math.round(vehicles.reduce((s, v) => s + (v.healthScore ?? 100), 0) / vehicleCount) : 100;

    const evo = (cur: number, prev: number): number => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;

    res.json({
      ownerPayout: Math.round(ownerPayout * 100) / 100,
      ownerPayoutEncaisse: Math.round(ownerPayoutEncaisse * 100) / 100,
      ownerPayoutPrevisionnel: Math.round(ownerPayoutPrevisionnel * 100) / 100,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      insuranceFee: Math.round(insuranceFee * 100) / 100,
      rentalCount,
      evolution: {
        ownerPayout: evo(ownerPayout, prevPayout),
        grossRevenue: evo(grossRevenue, prevGross),
        rentalCount: evo(rentalCount, prevCount),
      },
      occupancyRate,
      avgDuration: Math.round(avgDuration * 10) / 10,
      avgKmPerRental: Math.round(avgKmPerRental),
      revpar: Math.round(revpar * 100) / 100,
      extraFeesRate,
      totalKm,
      fleetHealthScore,
      vehicleCount,
      alerts: { pendingMaintenances: pendingMaints, expiringCT: expiringCTs },
    });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/annual-kpis — KPIs annuels (1 jan → 31 déc) + histogramme 12 mois
router.get('/annual-kpis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    const safeAmt = (v: number | null | undefined): number => Math.max(0, v ?? 0);

    const rentals = await db.rental.findMany({
      where: {
        startAt: { gte: yearStart, lte: yearEnd },
        status: { in: ['booked', 'active', 'completed'] },
      },
      select: {
        vehicleId: true, startAt: true, endAt: true, status: true,
        grossRevenue: true, ownerPayout: true, kmDriven: true,
      },
    });

    // Filtrer les annulations et clamp négatifs
    const valid = rentals.filter(r => r.status !== 'cancelled');

    const totalEncaisse   = valid.filter(r => (r.ownerPayout ?? 0) > 0)
      .reduce((s, r) => s + safeAmt(r.ownerPayout), 0);
    const totalPrevisionnel = valid.filter(r => (r.ownerPayout ?? 0) <= 0)
      .reduce((s, r) => s + safeAmt(r.grossRevenue) * 0.70, 0);

    const vehicles = await db.vehicle.findMany({
      where: { isActive: true }, select: { id: true },
    });
    const vehicleCount = vehicles.length;
    const daysSinceYearStart = Math.max(1,
      (now.getTime() - yearStart.getTime()) / 86_400_000
    );
    const totalRentalDays = valid.reduce((s, r) =>
      s + Math.max(0, (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000), 0);
    const occupancyRate = vehicleCount > 0
      ? Math.round((totalRentalDays / (vehicleCount * daysSinceYearStart)) * 100) : 0;

    const totalKm = valid.reduce((s, r) => s + safeAmt(r.kmDriven), 0);

    // Histogramme mensuel
    const months: Record<string, { encaisse: number; previsionnel: number; rentalCount: number; km: number }> = {};
    for (let m = 0; m < 12; m++) {
      const key = `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`;
      months[key] = { encaisse: 0, previsionnel: 0, rentalCount: 0, km: 0 };
    }
    for (const r of valid) {
      const key = new Date(r.startAt).toISOString().slice(0, 7);
      if (!(key in months)) continue;
      months[key].rentalCount++;
      months[key].km += safeAmt(r.kmDriven);
      if ((r.ownerPayout ?? 0) > 0) {
        months[key].encaisse += safeAmt(r.ownerPayout);
      } else {
        months[key].previsionnel += safeAmt(r.grossRevenue) * 0.70;
      }
    }

    const FR_MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    const monthlyData = Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([key, v], i) => ({
      month: key,
      label: FR_MONTHS[i] ?? key,
      encaisse: Math.round(v.encaisse * 100) / 100,
      previsionnel: Math.round(v.previsionnel * 100) / 100,
      total: Math.round((v.encaisse + v.previsionnel) * 100) / 100,
      rentalCount: v.rentalCount,
      km: v.km,
    }));

    res.json({
      totalEncaisse: Math.round(totalEncaisse * 100) / 100,
      totalPrevisionnel: Math.round(totalPrevisionnel * 100) / 100,
      totalCA: Math.round((totalEncaisse + totalPrevisionnel) * 100) / 100,
      rentalCount: valid.length,
      occupancyRate,
      totalKm,
      vehicleCount,
      monthlyData,
    });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/performance
router.get('/performance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);
    const now = new Date();

    const [vehicles, rentals, incidents] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, make: true, model: true, licensePlate: true, healthScore: true },
      }),
      db.rental.findMany({
        where: { startAt: { gte: sixMonthsAgo }, status: { in: ['booked', 'active', 'completed'] } },
        select: {
          vehicleId: true, startAt: true, endAt: true, status: true, grossRevenue: true, ownerPayout: true,
          insuranceFee: true, kmDriven: true, gasRefillFee: true, lateReturnFee: true,
          driverMessFee: true, damageCompensation: true,
        },
      }),
      db.incident.findMany({
        where: { createdAt: { gte: sixMonthsAgo } },
        select: { vehicleId: true },
      }),
    ]);

    const safeP = (v: number | null | undefined): number => Math.max(0, v ?? 0);
    const sum = (arr: Array<number | null | undefined>): number => arr.reduce<number>((s, v) => s + safeP(v), 0);

    const performance = vehicles.map(v => {
      const vRentals = rentals.filter(r => r.vehicleId === v.id && r.status !== 'cancelled' as string);
      const encaisseR = vRentals.filter(r => (r.ownerPayout ?? 0) > 0);
      const previsR   = vRentals.filter(r => (r.ownerPayout ?? 0) <= 0);
      const totalEncaisse = sum(encaisseR.map(r => r.ownerPayout));
      const totalPrevisionnel = previsR.reduce((s, r) => s + safeP(r.grossRevenue) * 0.70, 0);
      const totalPayout = totalEncaisse + totalPrevisionnel;
      const totalGross = sum(vRentals.map(r => r.grossRevenue));
      const totalInsurance = sum(vRentals.map(r => r.insuranceFee));
      const rentalCount = vRentals.length;

      const totalDays = vRentals.reduce((s, r) =>
        s + Math.max(0, (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000), 0);
      const avgDuration = rentalCount > 0 ? totalDays / rentalCount : 0;
      const totalKm = sum(vRentals.map(r => r.kmDriven));
      const avgKmPerRental = rentalCount > 0 ? totalKm / rentalCount : 0;
      const occupancyRate = Math.round((totalDays / 180) * 100);

      const withExtra = vRentals.filter(r =>
        (r.gasRefillFee ?? 0) > 0 || (r.lateReturnFee ?? 0) > 0 ||
        (r.driverMessFee ?? 0) > 0 || (r.damageCompensation ?? 0) > 0
      ).length;
      const extraFeesRate = rentalCount > 0 ? Math.round((withExtra / rentalCount) * 100) : 0;

      // Grouper CA par mois (6 derniers mois)
      const months: Record<string, number> = {};
      vRentals.forEach(r => {
        const key = new Date(r.startAt).toISOString().slice(0, 7);
        months[key] = (months[key] ?? 0) + getEffectivePayout(r.ownerPayout, r.grossRevenue);
      });
      const allMonths: string[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        allMonths.push(d.toISOString().slice(0, 7));
      }
      const monthlyCA = allMonths.map(month => ({
        month,
        ca: Math.round((months[month] ?? 0) * 100) / 100,
      }));

      return {
        vehicleId: v.id,
        make: v.make,
        model: v.model,
        licensePlate: v.licensePlate,
        label: v.licensePlate, // axe X des graphiques
        totalPayout: Math.round(totalPayout * 100) / 100,
        totalEncaisse: Math.round(totalEncaisse * 100) / 100,
        totalPrevisionnel: Math.round(totalPrevisionnel * 100) / 100,
        totalGross: Math.round(totalGross * 100) / 100,
        totalInsurance: Math.round(totalInsurance * 100) / 100,
        rentalCount,
        avgDuration: Math.round(avgDuration * 10) / 10,
        avgKmPerRental: Math.round(avgKmPerRental),
        occupancyRate,
        incidentCount: incidents.filter(i => i.vehicleId === v.id).length,
        extraFeesRate,
        healthScore: v.healthScore ?? 100,
        monthlyCA,
      };
    });

    res.json({ performance });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/rentability
router.get('/rentability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [vehicles, rentals, costs] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, make: true, model: true, licensePlate: true },
      }),
      db.rental.findMany({
        where: { startAt: { gte: monthStart }, status: { in: ['booked', 'active', 'completed'] } },
        select: { vehicleId: true, ownerPayout: true, grossRevenue: true },
      }),
      db.vehicleCost.findMany({ select: { vehicleId: true, amount: true, type: true } }),
    ]);

    const rentability = vehicles.map(v => {
      const vRentals = rentals.filter(r => r.vehicleId === v.id);
      const caNet = vRentals.reduce((s, r) => s + getEffectivePayout(r.ownerPayout, r.grossRevenue), 0);
      const caGross = vRentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);
      const vCosts = costs.filter(c => c.vehicleId === v.id);
      const fixedCosts = vCosts.filter(c => c.type === 'fixed').reduce((s, c) => s + c.amount, 0);
      const variableCosts = vCosts.filter(c => c.type !== 'fixed').reduce((s, c) => s + c.amount, 0);
      const totalCosts = fixedCosts + variableCosts;
      const margin = caNet - totalCosts;

      return {
        vehicleId: v.id,
        make: v.make,
        model: v.model,
        licensePlate: v.licensePlate,
        caNet: Math.round(caNet * 100) / 100,
        caGross: Math.round(caGross * 100) / 100,
        fixedCosts: Math.round(fixedCosts * 100) / 100,
        variableCosts: Math.round(variableCosts * 100) / 100,
        totalCosts: Math.round(totalCosts * 100) / 100,
        margin: Math.round(margin * 100) / 100,
        isProfit: margin >= 0,
      };
    });

    res.json({ rentability });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/forecasts — 4 semaines glissantes à partir d'aujourd'hui
router.get('/forecasts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const safeAmt = (v: number | null | undefined): number => Math.max(0, v ?? 0);

    // 4 semaines glissantes : S1=aujourd'hui..+6j, S2=+7..+13j, etc.
    const weekWindows: Array<{ start: Date; end: Date; label: string }> = [];
    const FR_MONTHS_SHORT = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
    for (let w = 0; w < 4; w++) {
      const start = new Date(now);
      start.setDate(now.getDate() + w * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      const fmt = (d: Date) => `${d.getDate()} ${FR_MONTHS_SHORT[d.getMonth()]}`;
      weekWindows.push({ start, end, label: `${fmt(start)} – ${fmt(end)}` });
    }

    const fourWeeksOut = weekWindows[3].end;

    const rentals = await db.rental.findMany({
      where: {
        status: { in: ['booked', 'active', 'completed'] },
        startAt: { lte: fourWeeksOut },
        endAt: { gte: now },
      },
      select: { vehicleId: true, ownerPayout: true, grossRevenue: true, startAt: true, endAt: true, status: true },
    });

    const forecasts = weekWindows.map(w => {
      const weekRentals = rentals.filter(r => {
        const s = new Date(r.startAt);
        return s >= w.start && s <= w.end;
      });
      let encaisse = 0, previsionnel = 0;
      for (const r of weekRentals) {
        if ((r.ownerPayout ?? 0) > 0) {
          encaisse += safeAmt(r.ownerPayout);
        } else {
          previsionnel += safeAmt(r.grossRevenue) * 0.70;
        }
      }
      return {
        week: w.label,
        label: w.label,
        rentalCount: weekRentals.length,
        encaisse: Math.round(encaisse * 100) / 100,
        previsionnel: Math.round(previsionnel * 100) / 100,
        totalPayout: Math.round((encaisse + previsionnel) * 100) / 100,
      };
    });

    const totalForecast = forecasts.reduce((s, f) => s + f.totalPayout, 0);

    res.json({ forecasts, totalForecast: Math.round(totalForecast * 100) / 100 });
  } catch (err) { next(err); }
});

// POST /api/v1/intelligence/chat
router.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { question } = req.body as { question?: string };
    if (!question?.trim()) { res.status(400).json({ error: 'Question vide' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);

    const [vehicles, rentals, incidents, maintenances] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, make: true, model: true, licensePlate: true,
                  parkingZone: true, currentMileage: true, year: true, healthScore: true },
      }),
      db.rental.findMany({
        where: { startAt: { gte: oneYearAgo } },
        select: {
          vehicleId: true, startAt: true, endAt: true, status: true,
          grossRevenue: true, ownerPayout: true, insuranceFee: true,
          basePrice: true, extraDistanceFee: true, kmDriven: true,
          gasRefillFee: true, lateReturnFee: true, driverMessFee: true,
          damageCompensation: true, driverName: true,
          vehicle: { select: { make: true, model: true, licensePlate: true, parkingZone: true } },
        },
      }),
      db.incident.findMany({
        where: { createdAt: { gte: oneYearAgo } },
        select: { vehicleId: true, type: true, cost: true, createdAt: true },
      }),
      db.maintenance.findMany({
        where: { nextServiceDate: { not: null, lte: now } },
        select: { vehicleId: true, type: true, cost: true },
      }),
    ]);

    const vehicleStats = vehicles.map(v => {
      const vRentals = rentals.filter(r => r.vehicleId === v.id && r.status !== 'cancelled');
      const totalPayout = vRentals.reduce((s, r) => s + getEffectivePayout(r.ownerPayout, r.grossRevenue), 0);
      const totalGross = vRentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);
      const totalInsurance = vRentals.reduce((s, r) => s + (r.insuranceFee ?? 0), 0);
      const totalKm = vRentals.reduce((s, r) => s + (r.kmDriven ?? 0), 0);
      return {
        vehicule: `${v.make} ${v.model} (${v.licensePlate})`,
        zone: v.parkingZone ?? 'Non définie',
        annee: v.year,
        kilometrage: v.currentMileage,
        scoreSante: v.healthScore,
        nbLocations: vRentals.length,
        caBrut: Math.round(totalGross * 100) / 100,
        caNet: Math.round(totalPayout * 100) / 100,
        assurance: Math.round(totalInsurance * 100) / 100,
        kmTotal: totalKm,
        incidents: incidents.filter(i => i.vehicleId === v.id).length,
        maintenancesEnAttente: maintenances.filter(m => m.vehicleId === v.id).length,
      };
    });

    const monthlyData: Record<string, { gross: number; payout: number; count: number }> = {};
    rentals.filter(r => r.status !== 'cancelled').forEach(r => {
      const key = new Date(r.startAt).toISOString().slice(0, 7);
      if (!monthlyData[key]) monthlyData[key] = { gross: 0, payout: 0, count: 0 };
      monthlyData[key].gross += r.grossRevenue ?? 0;
      monthlyData[key].payout += getEffectivePayout(r.ownerPayout, r.grossRevenue);
      monthlyData[key].count++;
    });

    const zoneData: Record<string, { payout: number; count: number }> = {};
    rentals.filter(r => r.status !== 'cancelled').forEach(r => {
      const zone = r.vehicle?.parkingZone ?? 'Non définie';
      if (!zoneData[zone]) zoneData[zone] = { payout: 0, count: 0 };
      zoneData[zone].payout += getEffectivePayout(r.ownerPayout, r.grossRevenue);
      zoneData[zone].count++;
    });

    const dataContext = JSON.stringify({
      dateAnalyse: now.toLocaleDateString('fr-FR'),
      periodeAnalyse: '12 derniers mois',
      vehicules: vehicleStats,
      parMois: Object.entries(monthlyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mois, d]) => ({
          mois,
          caBrut: Math.round(d.gross * 100) / 100,
          caNet: Math.round(d.payout * 100) / 100,
          nbLocations: d.count,
        })),
      parZone: Object.entries(zoneData).map(([zone, d]) => ({
        zone,
        caNet: Math.round(d.payout * 100) / 100,
        nbLocations: d.count,
      })),
    }, null, 2);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `Tu es l'assistant analytique de Sun and Drive, service de location de voitures.
Tu as accès aux données réelles de la flotte sur les 12 derniers mois.
Tu réponds en français, de façon concise, factuelle et précise.
Tu cites toujours les chiffres exacts issus des données.
Tu ne fais JAMAIS de suppositions ou d'estimations — uniquement des données réelles.
Si la donnée demandée n'est pas disponible, tu le dis clairement.
Tes réponses font 2-5 phrases maximum, sauf si un tableau est demandé.
Tu peux utiliser des listes courtes si nécessaire pour la lisibilité.

Données de la flotte :
${dataContext}`,
      messages: [{ role: 'user', content: question }],
    });

    const answer = response.content[0]?.type === 'text'
      ? response.content[0].text
      : 'Données insuffisantes pour répondre.';

    res.json({ question, answer, timestamp: now.toISOString() });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/pending-revenue — CA à encaisser + CA prévisionnel par mois
router.get('/pending-revenue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const nextThreeMonths = new Date(Date.now() + 90 * 86_400_000);

    const [completedUnpaid, futureRentals] = await Promise.all([
      // Locations terminées dont le paiement n'est pas encore reçu (ownerPayout null ou 0)
      db.rental.findMany({
        where: {
          status: 'completed',
          endAt: { lt: now },
          OR: [{ ownerPayout: null }, { ownerPayout: 0 }],
          grossRevenue: { gt: 0 },
        },
        select: { id: true, endAt: true, grossRevenue: true, ownerPayout: true, driverName: true, vehicleId: true },
        orderBy: { endAt: 'desc' },
      }),
      // Locations futures confirmées
      db.rental.findMany({
        where: {
          status: { in: ['booked', 'active'] },
          startAt: { gte: now, lte: nextThreeMonths },
        },
        select: { id: true, startAt: true, endAt: true, grossRevenue: true, ownerPayout: true, driverName: true, vehicleId: true },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    // CA à encaisser (locations terminées sans paiement)
    const pendingRevenue = completedUnpaid.reduce((s, r) => {
      // Estimation payout = 70% du grossRevenue si ownerPayout non renseigné
      const estimated = (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : (r.grossRevenue ?? 0) * 0.7;
      return s + estimated;
    }, 0);
    const oldestPendingDate = completedUnpaid.length > 0 ? completedUnpaid[completedUnpaid.length - 1].endAt : null;

    // CA prévisionnel groupé par mois
    const forecastByMonth: Record<string, { month: string; rentalCount: number; amount: number; estimated: boolean }> = {};
    futureRentals.forEach(r => {
      const month = new Date(r.startAt).toISOString().slice(0, 7);
      if (!forecastByMonth[month]) forecastByMonth[month] = { month, rentalCount: 0, amount: 0, estimated: false };
      const payout = (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : (r.grossRevenue ?? 0) * 0.7;
      forecastByMonth[month].rentalCount++;
      forecastByMonth[month].amount += payout;
      if ((r.ownerPayout ?? 0) === 0) forecastByMonth[month].estimated = true;
    });

    const forecastMonths = Object.values(forecastByMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, amount: Math.round(m.amount * 100) / 100 }));

    const forecastTotal = forecastMonths.reduce((s, m) => s + m.amount, 0);

    res.json({
      pendingRevenue: {
        amount: Math.round(pendingRevenue * 100) / 100,
        count: completedUnpaid.length,
        oldestDate: oldestPendingDate,
        note: 'Getaround paie le 4 du mois suivant',
      },
      forecastRevenue: {
        byMonth: forecastMonths,
        total: Math.round(forecastTotal * 100) / 100,
        count: futureRentals.length,
      },
    });
  } catch (err) { next(err); }
});

// Rapport CEO — monté ici pour éviter le double plan-gating depuis app.ts
router.use('/report', reportRouter);

export default router;
