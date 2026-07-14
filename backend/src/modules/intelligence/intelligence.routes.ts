import { Router, type Request, type Response, type NextFunction } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import { computeUnavailableDaysSet } from '../../utils/availability';
import { getTaskAlerts } from '../maintenance/maintenance.service';
import reportRouter from './report.routes';

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

    const [currentRentals, prevRentals, vehicles, pendingMaints, monthBlockings, monthUnavailabilities] = await Promise.all([
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
      // Définition unique "entretien/CT à prévoir" — cf. getTaskAlerts (maintenance.service.ts)
      getTaskAlerts(db),
      db.blocking.findMany({
        where: { startAt: { lte: now }, endAt: { gte: monthStart } },
        select: { vehicleId: true, startAt: true, endAt: true, type: true, reason: true },
      }),
      db.unavailability.findMany({
        where: { startsAt: { lte: now }, endsAt: { gte: monthStart } },
        select: { vehicleId: true, startsAt: true, endsAt: true },
      }),
    ]);
    // Sous-ensemble "CT dans les 30j" dérivé de la même source (pendingMaints),
    // pas d'une requête séparée — ancienne 4ᵉ implémentation éliminée.
    const expiringCTs = pendingMaints.filter(t =>
      t.type === 'ct' && t.nextDueDate != null && t.nextDueDate >= now && t.nextDueDate <= thirtyDaysFromNow,
    ).length;

    const safe = (v: number | null | undefined): number => Math.max(0, v ?? 0);
    const sum  = (arr: Array<number | null | undefined>): number => arr.reduce<number>((s, v) => s + safe(v), 0);

    // Règle CA : ownerPayout > 0 → encaissé ; sinon → prévisionnel = grossRevenue
    const encaisseRentals     = currentRentals.filter(r => (r.ownerPayout ?? 0) > 0);
    const previsionnelRentals = currentRentals.filter(r => !((r.ownerPayout ?? 0) > 0));
    const ownerPayoutEncaisse     = sum(encaisseRentals.map(r => r.ownerPayout));
    const ownerPayoutPrevisionnel = sum(previsionnelRentals.map(r => r.grossRevenue));
    const ownerPayout  = ownerPayoutEncaisse + ownerPayoutPrevisionnel;
    const grossRevenue = sum(currentRentals.map(r => r.grossRevenue));
    const insuranceFee = sum(currentRentals.map(r => r.insuranceFee));
    const rentalCount  = currentRentals.length;
    const prevPayout   = encaisseRentals.length > 0
      ? sum(prevRentals.filter(r => (r.ownerPayout ?? 0) > 0).map(r => r.ownerPayout))
      + sum(prevRentals.filter(r => !((r.ownerPayout ?? 0) > 0)).map(r => r.grossRevenue))
      : 0;
    const prevGross = sum(prevRentals.map(r => r.grossRevenue));
    const prevCount = prevRentals.length;

    const vehicleCount = vehicles.length;
    const vDaysKpis = new Map<string, Set<string>>();
    for (const r of currentRentals) {
      if (!vDaysKpis.has(r.vehicleId)) vDaysKpis.set(r.vehicleId, new Set());
      const ds = vDaysKpis.get(r.vehicleId)!;
      let d = new Date(r.startAt); d.setHours(0,0,0,0);
      const e = new Date(r.endAt); e.setHours(0,0,0,0);
      while (d <= e) { ds.add(d.toISOString().slice(0,10)); d = new Date(d.getTime() + 86_400_000); }
    }
    const totalDistinctDaysKpis = Array.from(vDaysKpis.values()).reduce((acc, s) => acc + s.size, 0);
    const occupancyRate = vehicleCount > 0 && daysInMonth > 0
      ? Math.min(100, Math.round((totalDistinctDaysKpis / (vehicleCount * daysInMonth)) * 100)) : 0;

    // Taux d'occupation corrigé : exclure les jours d'indisponibilité par véhicule
    const todayInMonth = Math.min(now.getDate(), daysInMonth);
    let totalOccupiedAdj = 0;
    let totalAvailableAdj = 0;
    let totalUnavailableDays = 0;
    const vehicleUnavailability: Array<{ vehicleId: string; unavailableDays: number; types: string[] }> = [];
    for (const v of vehicles) {
      const vBlockings = monthBlockings.filter(b => b.vehicleId === v.id);
      const vUnavail   = monthUnavailabilities.filter(u => u.vehicleId === v.id);
      const indispoSet = computeUnavailableDaysSet(
        vBlockings,
        vUnavail.map(u => ({ startsAt: u.startsAt, endsAt: u.endsAt })),
        monthStart,
        now,
      );
      const unavailableDays = indispoSet.size;
      const adjustedDays = Math.max(0, todayInMonth - unavailableDays);
      const occupiedDays = (vDaysKpis.get(v.id) ?? new Set<string>()).size;
      totalOccupiedAdj  += occupiedDays;
      totalAvailableAdj += adjustedDays;
      totalUnavailableDays += unavailableDays;
      vehicleUnavailability.push({
        vehicleId: v.id,
        unavailableDays,
        types: [...new Set(vBlockings.map(b => b.type))],
      });
    }
    const occupancyRateCorrected = totalAvailableAdj > 0
      ? Math.min(100, Math.round((totalOccupiedAdj / totalAvailableAdj) * 100))
      : occupancyRate;

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
      occupancyRateCorrected,
      unavailableDaysTotal: totalUnavailableDays,
      vehicleUnavailability,
      avgDuration: Math.round(avgDuration * 10) / 10,
      avgKmPerRental: Math.round(avgKmPerRental),
      revpar: Math.round(revpar * 100) / 100,
      extraFeesRate,
      totalKm,
      fleetHealthScore,
      vehicleCount,
      alerts: { pendingMaintenances: pendingMaints.length, expiringCT: expiringCTs },
    });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/annual-kpis — KPIs annuels + histogramme 12 mois décomposé
router.get('/annual-kpis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    const s = (v: number | null | undefined): number => Math.max(0, v ?? 0);

    const rentals = await db.rental.findMany({
      where: { startAt: { gte: yearStart, lte: yearEnd }, status: { in: ['booked', 'active', 'completed'] } },
      select: {
        vehicleId: true, startAt: true, endAt: true, status: true, kmDriven: true,
        grossRevenue: true, ownerPayout: true,
        basePrice: true, insuranceFee: true, driverMessFee: true, damageCompensation: true,
        lateReturnFee: true, gasRefillFee: true, extraDistanceFee: true,
        assistanceFee: true, deliveryFee: true,
        batteryRechargeFee: true, ownerInfractionFee: true, ownerTowFee: true,
        guaranteeEarning: true, otherCompensation: true, cancellationFee: true,
        getaroundServiceFee: true,
      },
    });

    const valid = rentals.filter(r => r.status !== 'cancelled');

    // Règle CA sans ratio
    const totalEncaisse     = valid.filter(r => s(r.ownerPayout) > 0).reduce((acc, r) => acc + s(r.ownerPayout), 0);
    const totalPrevisionnel = valid.filter(r => !(s(r.ownerPayout) > 0)).reduce((acc, r) => acc + s(r.grossRevenue), 0);

    const vehicles = await db.vehicle.findMany({ where: { isActive: true }, select: { id: true } });
    const vehicleCount = vehicles.length;

    const [vehicleCostsAll, annualMaints] = await Promise.all([
      db.vehicleCost.findMany({ select: { amount: true, type: true } }),
      db.maintenance.findMany({ where: { performedAt: { gte: yearStart, lte: yearEnd } }, select: { cost: true, performedAt: true } }),
    ]);
    const totalFixedCostsMonthly = vehicleCostsAll.filter(c => c.type === 'fixed').reduce((s, c) => s + c.amount, 0);
    const totalVariableCostsMonthly = vehicleCostsAll.filter(c => c.type !== 'fixed').reduce((s, c) => s + c.amount, 0);
    const daysSinceYearStart = Math.max(1, (now.getTime() - yearStart.getTime()) / 86_400_000);
    const vDaysAnnual = new Map<string, Set<string>>();
    for (const r of valid) {
      if (!vDaysAnnual.has(r.vehicleId)) vDaysAnnual.set(r.vehicleId, new Set());
      const ds = vDaysAnnual.get(r.vehicleId)!;
      let d = new Date(r.startAt); d.setHours(0,0,0,0);
      const e = new Date(r.endAt); e.setHours(0,0,0,0);
      while (d <= e) { ds.add(d.toISOString().slice(0,10)); d = new Date(d.getTime() + 86_400_000); }
    }
    const totalDistinctDaysAnnual = Array.from(vDaysAnnual.values()).reduce((acc, s) => acc + s.size, 0);
    const occupancyRate = vehicleCount > 0 ? Math.min(100, Math.round((totalDistinctDaysAnnual / (vehicleCount * daysSinceYearStart)) * 100)) : 0;
    const totalKm = valid.reduce((acc, r) => acc + s(r.kmDriven), 0);

    type MonthBucket = {
      encaisse: {
        total: number;
        basePrice: number; insuranceFee: number; driverMessFee: number; damageCompensation: number;
        lateReturnFee: number; gasRefillFee: number; extraDistanceFee: number;
        assistanceFee: number; deliveryFee: number; batteryRechargeFee: number;
        ownerInfractionFee: number; ownerTowFee: number; guaranteeEarning: number;
        otherCompensation: number; cancellationFee: number;
        getaroundServiceFee: number;
      };
      previsionnel: number; rentalCount: number; km: number;
    };
    const months: Record<string, MonthBucket> = {};
    const FR_MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    for (let m = 0; m < 12; m++) {
      const key = `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`;
      months[key] = {
        encaisse: {
          total: 0, basePrice: 0, insuranceFee: 0, driverMessFee: 0, damageCompensation: 0,
          lateReturnFee: 0, gasRefillFee: 0, extraDistanceFee: 0,
          assistanceFee: 0, deliveryFee: 0, batteryRechargeFee: 0,
          ownerInfractionFee: 0, ownerTowFee: 0, guaranteeEarning: 0,
          otherCompensation: 0, cancellationFee: 0,
          getaroundServiceFee: 0,
        },
        previsionnel: 0, rentalCount: 0, km: 0,
      };
    }
    for (const r of valid) {
      const key = new Date(r.startAt).toISOString().slice(0, 7);
      if (!(key in months)) continue;
      months[key].rentalCount++;
      months[key].km += s(r.kmDriven);
      if (s(r.ownerPayout) > 0) {
        const e = months[key].encaisse;
        e.total              += s(r.ownerPayout);
        e.basePrice          += s(r.basePrice);
        e.insuranceFee       += s(r.insuranceFee);
        e.driverMessFee      += s(r.driverMessFee);
        e.damageCompensation += s(r.damageCompensation);
        e.lateReturnFee      += s(r.lateReturnFee);
        e.gasRefillFee       += s(r.gasRefillFee);
        e.extraDistanceFee   += s(r.extraDistanceFee);
        e.assistanceFee      += s(r.assistanceFee);
        e.deliveryFee        += s(r.deliveryFee);
        e.batteryRechargeFee += s(r.batteryRechargeFee);
        e.ownerInfractionFee += s(r.ownerInfractionFee);
        e.ownerTowFee        += s(r.ownerTowFee);
        e.guaranteeEarning   += s(r.guaranteeEarning);
        e.otherCompensation  += s(r.otherCompensation);
        e.cancellationFee    += s(r.cancellationFee);
        e.getaroundServiceFee += r.getaroundServiceFee ?? 0;
      } else {
        months[key].previsionnel += s(r.grossRevenue);
      }
    }

    const rnd = (v: number) => Math.round(v * 100) / 100;
    const monthlyData = Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([key, v], i) => {
      const e = v.encaisse;
      const autres = rnd(e.lateReturnFee + e.gasRefillFee + e.extraDistanceFee
        + e.assistanceFee + e.deliveryFee + e.batteryRechargeFee
        + e.ownerInfractionFee + e.ownerTowFee + e.guaranteeEarning
        + e.otherCompensation + e.cancellationFee);
      return {
        month: key,
        label: FR_MONTHS[i] ?? key,
        encaisse: {
          total:              rnd(e.total),
          basePrice:          rnd(e.basePrice),
          insuranceFee:       rnd(e.insuranceFee),
          driverMessFee:      rnd(e.driverMessFee),
          damageCompensation: rnd(e.damageCompensation),
          lateReturnFee:      rnd(e.lateReturnFee),
          gasRefillFee:       rnd(e.gasRefillFee),
          extraDistanceFee:   rnd(e.extraDistanceFee),
          assistanceFee:      rnd(e.assistanceFee),
          deliveryFee:        rnd(e.deliveryFee),
          batteryRechargeFee: rnd(e.batteryRechargeFee),
          ownerInfractionFee: rnd(e.ownerInfractionFee),
          ownerTowFee:        rnd(e.ownerTowFee),
          guaranteeEarning:   rnd(e.guaranteeEarning),
          otherCompensation:  rnd(e.otherCompensation),
          cancellationFee:    rnd(e.cancellationFee),
          getaroundServiceFee: rnd(e.getaroundServiceFee),
          autres,
        },
        previsionnel: rnd(v.previsionnel),
        total: rnd(e.total + v.previsionnel),
        rentalCount: v.rentalCount,
        km: v.km,
        ...((): { costsFixed: number; costsVariable: number; costsTotal: number; margin: number } => {
          const maint = annualMaints.filter(m => new Date(m.performedAt).toISOString().slice(0, 7) === key).reduce((s, m) => s + (m.cost ?? 0), 0);
          const costsFixed = rnd(totalFixedCostsMonthly);
          const costsVariable = rnd(totalVariableCostsMonthly + maint);
          const costsTotal = rnd(costsFixed + costsVariable);
          return { costsFixed, costsVariable, costsTotal, margin: rnd(e.total + v.previsionnel - costsTotal) };
        })(),
      };
    });

    res.json({
      totalEncaisse: rnd(totalEncaisse), totalPrevisionnel: rnd(totalPrevisionnel),
      totalCA: rnd(totalEncaisse + totalPrevisionnel),
      rentalCount: valid.length, occupancyRate, totalKm, vehicleCount, monthlyData,
    });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/performance
router.get('/performance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);
    const now = new Date();

    const [vehicles, rentals, incidents, perfBlockings, perfUnavailabilities] = await Promise.all([
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
      db.blocking.findMany({
        where: { startAt: { lte: now }, endAt: { gte: sixMonthsAgo } },
        select: { vehicleId: true, startAt: true, endAt: true, type: true, reason: true },
      }),
      db.unavailability.findMany({
        where: { startsAt: { lte: now }, endsAt: { gte: sixMonthsAgo } },
        select: { vehicleId: true, startsAt: true, endsAt: true },
      }),
    ]);

    const sp = (v: number | null | undefined): number => Math.max(0, v ?? 0);
    const sumArr = (arr: Array<number | null | undefined>): number => arr.reduce<number>((acc, v) => acc + sp(v), 0);
    const rnd2 = (v: number) => Math.round(v * 100) / 100;

    // Construire les 6 mois pour l'axe X
    const allMonths: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      allMonths.push(d.toISOString().slice(0, 7));
    }

    const performance = vehicles.map(v => {
      const vRentals = rentals.filter(r => r.vehicleId === v.id && r.status !== 'cancelled' as string);
      const encaisseR = vRentals.filter(r => sp(r.ownerPayout) > 0);
      const previsR   = vRentals.filter(r => !(sp(r.ownerPayout) > 0));
      const totalEncaisse     = sumArr(encaisseR.map(r => r.ownerPayout));
      const totalPrevisionnel = sumArr(previsR.map(r => r.grossRevenue));
      const totalPayout    = totalEncaisse + totalPrevisionnel;
      const totalGross     = sumArr(vRentals.map(r => r.grossRevenue));
      const totalInsurance = sumArr(vRentals.map(r => r.insuranceFee));
      const rentalCount    = vRentals.length;

      const totalDays = vRentals.reduce((acc, r) =>
        acc + Math.max(0, (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000), 0);
      const avgDuration    = rentalCount > 0 ? totalDays / rentalCount : 0;
      const totalKm        = sumArr(vRentals.map(r => r.kmDriven));
      const avgKmPerRental = rentalCount > 0 ? totalKm / rentalCount : 0;
      const occSet = new Set<string>();
      for (const r of vRentals) {
        let od = new Date(r.startAt); od.setHours(0,0,0,0);
        const oe = new Date(r.endAt); oe.setHours(0,0,0,0);
        while (od <= oe) { occSet.add(od.toISOString().slice(0,10)); od = new Date(od.getTime() + 86_400_000); }
      }
      const occupancyRate = Math.min(100, Math.round((occSet.size / 180) * 100));

      // Taux corrigé par véhicule sur 6 mois
      const vBlockingsPerf = perfBlockings.filter(b => b.vehicleId === v.id);
      const vUnavailPerf   = perfUnavailabilities.filter(u => u.vehicleId === v.id);
      const indispoSet6m = computeUnavailableDaysSet(
        vBlockingsPerf,
        vUnavailPerf.map(u => ({ startsAt: u.startsAt, endsAt: u.endsAt })),
        sixMonthsAgo,
        now,
      );
      const unavailableDays = indispoSet6m.size;
      const adjustedDays6m = Math.max(1, 180 - unavailableDays);
      const occupancyRateCorrected = Math.min(100, Math.round((occSet.size / adjustedDays6m) * 100));
      const indispoTypes = [...new Set(vBlockingsPerf.map(b => b.type))];

      const withExtra = vRentals.filter(r =>
        (r.gasRefillFee ?? 0) > 0 || (r.lateReturnFee ?? 0) > 0 ||
        (r.driverMessFee ?? 0) > 0 || (r.damageCompensation ?? 0) > 0
      ).length;
      const extraFeesRate = rentalCount > 0 ? Math.round((withExtra / rentalCount) * 100) : 0;

      // CA par mois (par véhicule) — règle sans ratio
      const monthBuckets: Record<string, { ca: number; encaisse: number; previsionnel: number; count: number; km: number }> = {};
      vRentals.forEach(r => {
        const key = new Date(r.startAt).toISOString().slice(0, 7);
        if (!monthBuckets[key]) monthBuckets[key] = { ca: 0, encaisse: 0, previsionnel: 0, count: 0, km: 0 };
        monthBuckets[key].count++;
        monthBuckets[key].km += sp(r.kmDriven);
        if (sp(r.ownerPayout) > 0) {
          monthBuckets[key].encaisse += sp(r.ownerPayout);
          monthBuckets[key].ca      += sp(r.ownerPayout);
        } else {
          monthBuckets[key].previsionnel += sp(r.grossRevenue);
          monthBuckets[key].ca          += sp(r.grossRevenue);
        }
      });

      // Taux d'occupation par mois (jours loués / jours du mois)
      const monthlyCA = allMonths.map(month => {
        const b = monthBuckets[month] ?? { ca: 0, encaisse: 0, previsionnel: 0, count: 0, km: 0 };
        const [yearStr, monthStr] = month.split('-');
        const daysInMonth = new Date(parseInt(yearStr!), parseInt(monthStr!), 0).getDate();
        const monthOccSet = new Set<string>();
        for (const r of vRentals.filter(r2 => new Date(r2.startAt).toISOString().slice(0,7) === month)) {
          let md = new Date(r.startAt); md.setHours(0,0,0,0);
          const me = new Date(r.endAt); me.setHours(0,0,0,0);
          while (md <= me) {
            const mds = md.toISOString().slice(0,10);
            if (mds.slice(0,7) === month) monthOccSet.add(mds);
            md = new Date(md.getTime() + 86_400_000);
          }
        }
        const occupancy = daysInMonth > 0 ? Math.min(100, Math.round((monthOccSet.size / daysInMonth) * 100)) : 0;
        return {
          month,
          ca: rnd2(b.ca),
          encaisse: rnd2(b.encaisse),
          previsionnel: rnd2(b.previsionnel),
          occupancy,
          count: b.count,
          km: b.km,
        };
      });

      return {
        vehicleId: v.id,
        make: v.make,
        model: v.model,
        licensePlate: v.licensePlate,
        label: v.licensePlate,
        totalPayout:        rnd2(totalPayout),
        totalEncaisse:      rnd2(totalEncaisse),
        totalPrevisionnel:  rnd2(totalPrevisionnel),
        totalGross:         rnd2(totalGross),
        totalInsurance:     rnd2(totalInsurance),
        rentalCount,
        avgDuration:        Math.round(avgDuration * 10) / 10,
        avgKmPerRental:     Math.round(avgKmPerRental),
        occupancyRate,
        occupancyRateCorrected,
        unavailableDays,
        indispoTypes,
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

    // CA mensuel = moyenne glissante sur N mois complets (endAt dans la fenêtre)
    const settings = await db.companySettings.findFirst({ select: { roiCaMoyenMois: true } });
    const N = settings?.roiCaMoyenMois ?? 5;
    const windowEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(windowEnd.getFullYear(), windowEnd.getMonth() - N, 1);

    const yearStart = new Date(Date.now() - 365 * 86_400_000);
    const [vehicles, rentals, costs, annualMaintenances] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, make: true, model: true, licensePlate: true },
      }),
      db.rental.findMany({
        where: { endAt: { gte: windowStart, lt: windowEnd }, status: { in: ['booked', 'active', 'completed'] } },
        select: { vehicleId: true, ownerPayout: true, grossRevenue: true },
      }),
      db.vehicleCost.findMany({ select: { vehicleId: true, amount: true, type: true, amortizationMonths: true, endDate: true } }),
      db.maintenance.findMany({ where: { performedAt: { gte: yearStart } }, select: { vehicleId: true, cost: true } }),
    ]);

    const rentability = vehicles.map(v => {
      const vRentals = rentals.filter(r => r.vehicleId === v.id);
      // Somme sur N mois, divisée par N pour la moyenne mensuelle
      const caNetTotal = vRentals.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)), 0);
      const caNet = caNetTotal / N;
      const caGross = vRentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0) / N;
      const vCosts = costs.filter(c => c.vehicleId === v.id && (!c.endDate || new Date(c.endDate) > now));
      const fixedCosts = vCosts.filter(c => c.type === 'fixed').reduce((s, c) => s + c.amount, 0);
      const variableCosts = vCosts.filter(c => c.type === 'onetime').reduce((s, c) => s + c.amount / (c.amortizationMonths ?? 1), 0);
      const annualMaintCosts = annualMaintenances.filter(m => m.vehicleId === v.id).reduce((s, m) => s + (m.cost ?? 0), 0);
      const maintenanceMensuel = annualMaintCosts / 12;
      const getaroundFees = vRentals.filter(r => (r.ownerPayout ?? 0) > 0).reduce((s, r) => s + Math.max(0, (r.grossRevenue ?? 0) - r.ownerPayout!), 0) / N;
      const totalCostsWithMaint = fixedCosts + variableCosts + maintenanceMensuel;
      const marginWithMaint = caNet - totalCostsWithMaint;
      // CA annuel = extrapolation linéaire depuis la moyenne mensuelle
      const caAnnuel = caNet * 12;
      const costsAnnuels = fixedCosts * 12 + annualMaintCosts;
      const margeAnnuelle = caAnnuel - costsAnnuels;

      return {
        vehicleId: v.id,
        make: v.make,
        model: v.model,
        licensePlate: v.licensePlate,
        caNet: Math.round(caNet * 100) / 100,
        caGross: Math.round(caGross * 100) / 100,
        fixedCosts: Math.round(fixedCosts * 100) / 100,
        variableCosts: Math.round(variableCosts * 100) / 100,
        maintenanceMensuel: Math.round(maintenanceMensuel * 100) / 100,
        getaroundFees: Math.round(getaroundFees * 100) / 100,
        totalCosts: Math.round(totalCostsWithMaint * 100) / 100,
        breakEven: Math.round(totalCostsWithMaint * 100) / 100,
        margin: Math.round(marginWithMaint * 100) / 100,
        isProfit: marginWithMaint >= 0,
        status: marginWithMaint >= 0 ? 'rentable' : 'déficitaire',
        caAnnuel: Math.round(caAnnuel * 100) / 100,
        costsAnnuels: Math.round(costsAnnuels * 100) / 100,
        margeAnnuelle: Math.round(margeAnnuelle * 100) / 100,
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
    for (let w = 0; w < 8; w++) {
      const start = new Date(now);
      start.setDate(now.getDate() + w * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      const fmt = (d: Date) => `${d.getDate()} ${FR_MONTHS_SHORT[d.getMonth()]}`;
      weekWindows.push({ start, end, label: `${fmt(start)} – ${fmt(end)}` });
    }

    const fourWeeksOut = weekWindows[7].end;

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
          previsionnel += safeAmt(r.grossRevenue);
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
    const twoYearsAgo = new Date(Date.now() - 24 * 30 * 86_400_000);
    const oneYearAgo = new Date(Date.now() - 12 * 30 * 86_400_000);

    const [vehicles, rentals, incidents, maintenances] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, make: true, model: true, licensePlate: true,
                  parkingZone: true, currentMileage: true, year: true, healthScore: true },
      }),
      db.rental.findMany({
        where: { startAt: { gte: twoYearsAgo } },
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
      db.maintenanceTask.findMany({
        where: {
          vehicle: { isActive: true },
          OR: [
            { nextDueDate: { lte: now } },
            { ctCounterVisitDeadline: { lte: now } },
          ],
        },
        select: { vehicleId: true },
      }),
    ]);

    const vehicleStats = vehicles.map(v => {
      const vRentals = rentals.filter(r => r.vehicleId === v.id && r.status !== 'cancelled');
      const totalPayout = vRentals.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)), 0);
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
      monthlyData[key].payout += (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0);
      monthlyData[key].count++;
    });

    const zoneData: Record<string, { payout: number; count: number }> = {};
    rentals.filter(r => r.status !== 'cancelled').forEach(r => {
      const zone = r.vehicle?.parkingZone ?? 'Non définie';
      if (!zoneData[zone]) zoneData[zone] = { payout: 0, count: 0 };
      zoneData[zone].payout += (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0);
      zoneData[zone].count++;
    });

    // Per-vehicle per-month breakdown
    const vehicleMonthlyMap: Record<string, Record<string, { gross: number; payout: number; count: number; km: number; daysBooked: number }>> = {};
    rentals.filter(r => r.status !== 'cancelled').forEach(r => {
      const vId = r.vehicleId;
      const month = new Date(r.startAt).toISOString().slice(0, 7);
      if (!vehicleMonthlyMap[vId]) vehicleMonthlyMap[vId] = {};
      if (!vehicleMonthlyMap[vId][month]) vehicleMonthlyMap[vId][month] = { gross: 0, payout: 0, count: 0, km: 0, daysBooked: 0 };
      vehicleMonthlyMap[vId][month].gross += r.grossRevenue ?? 0;
      vehicleMonthlyMap[vId][month].payout += (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0);
      vehicleMonthlyMap[vId][month].count++;
      vehicleMonthlyMap[vId][month].km += r.kmDriven ?? 0;
      const days = Math.ceil((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000);
      vehicleMonthlyMap[vId][month].daysBooked += days;
    });

    const sixMonthsCutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 7);
    const parVehiculeParMois = vehicles.map(v => {
      const mois = vehicleMonthlyMap[v.id] ?? {};
      return {
        vehicule: `${v.make} ${v.model} (${v.licensePlate})`,
        mois: Object.entries(mois)
          .filter(([m]) => m >= sixMonthsCutoff)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([m, d]) => {
            const daysInMonth = new Date(parseInt(m.slice(0, 4)), parseInt(m.slice(5, 7)), 0).getDate();
            return {
              mois: m,
              caNet: Math.round(d.payout * 100) / 100,
              caBrut: Math.round(d.gross * 100) / 100,
              nbLocations: d.count,
              km: d.km,
              tauxOccupation: Math.round(Math.min(d.daysBooked, daysInMonth) / daysInMonth * 100),
            };
          }),
      };
    });

    const dataContext = JSON.stringify({
      dateAnalyse: now.toLocaleDateString('fr-FR'),
      periodeAnalyse: '24 derniers mois',
      vehicules: vehicleStats,
      parVehiculeParMois,
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
Tu as accès aux données réelles de la flotte sur les 24 derniers mois.
Tu réponds en français, de façon concise, factuelle et précise.
Tu cites toujours les chiffres exacts issus des données.
Tu ne fais JAMAIS de suppositions ou d'estimations — uniquement des données réelles.
Si la donnée demandée n'est pas disponible, tu le dis clairement.
Tes réponses font 2-5 phrases maximum, sauf si un tableau est demandé.
Tu peux utiliser des listes courtes si nécessaire pour la lisibilité.

Données détaillées par véhicule disponibles dans parVehiculeParMois : CA net, CA brut, nombre de locations, km parcourus et taux d'occupation pour chaque véhicule et chaque mois. Tu peux répondre à des questions sur n'importe quelle période, n'importe quel véhicule, et comparer des périodes entre elles.

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
    const nextThreeMonths = new Date(Date.now() + 30 * 86_400_000);

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

    // CA à encaisser (locations terminées sans paiement) = grossRevenue direct
    const pendingRevenue = completedUnpaid.reduce((s, r) => s + Math.max(0, r.grossRevenue ?? 0), 0);
    const oldestPendingDate = completedUnpaid.length > 0 ? completedUnpaid[completedUnpaid.length - 1].endAt : null;

    // CA prévisionnel groupé par mois
    const forecastByMonth: Record<string, { month: string; rentalCount: number; amount: number; estimated: boolean }> = {};
    futureRentals.forEach(r => {
      const month = new Date(r.startAt).toISOString().slice(0, 7);
      if (!forecastByMonth[month]) forecastByMonth[month] = { month, rentalCount: 0, amount: 0, estimated: false };
      const payout = (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0);
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

// GET /api/v1/intelligence/suggestions — suggestions IA, cache 24h
interface AiSuggestion { title: string; description: string; type: 'alert' | 'opportunity' | 'info'; priority: 'high' | 'medium' | 'low'; }
const suggestionsCache = new Map<string, { data: AiSuggestion[]; ts: number }>();

router.get('/suggestions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantSlug = req.auth!.tenantSlug;
    const force = req.query.force === '1';
    const cacheKey = `suggestions:${tenantSlug}`;
    const cached = suggestionsCache.get(cacheKey);

    const db = getTenantClient(req.tenantDbUrl!);

    // TTL configurable (défaut 1h)
    if (!force && cached) {
      const settings = await db.companySettings.findFirst({ select: { suggestionsCacheTtlHours: true } });
      const ttlMs = (settings?.suggestionsCacheTtlHours ?? 1) * 3_600_000;
      if (Date.now() - cached.ts < ttlMs) {
        res.json({ suggestions: cached.data });
        return;
      }
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);

    const [vehicles, currentRentals, sixMoRentals, pendingMaints, openIncidents] = await Promise.all([
      db.vehicle.findMany({ where: { isActive: true }, select: { id: true, make: true, model: true, licensePlate: true, healthScore: true } }),
      db.rental.findMany({
        where: { startAt: { gte: monthStart }, status: { in: ['booked', 'active', 'completed'] } },
        select: { vehicleId: true, ownerPayout: true, grossRevenue: true },
      }),
      db.rental.findMany({
        where: { startAt: { gte: sixMonthsAgo }, status: { in: ['completed', 'active', 'booked'] } },
        select: { vehicleId: true, ownerPayout: true, grossRevenue: true, startAt: true, endAt: true },
      }),
      // Définition unique "entretien/CT à prévoir" — cf. getTaskAlerts (maintenance.service.ts)
      getTaskAlerts(db),
      db.incident.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    ]);

    const s = (v: number | null | undefined) => Math.max(0, v ?? 0);
    const vehicleStats = vehicles.map(v => {
      const vCur = currentRentals.filter(r => r.vehicleId === v.id);
      const caMois = vCur.reduce((acc, r) => acc + (s(r.ownerPayout) > 0 ? s(r.ownerPayout) : s(r.grossRevenue)), 0);
      const vSix = sixMoRentals.filter(r => r.vehicleId === v.id);
      const ca6m = vSix.reduce((acc, r) => acc + (s(r.ownerPayout) > 0 ? s(r.ownerPayout) : s(r.grossRevenue)), 0);
      const totalDays = vSix.reduce((acc, r) => acc + Math.max(0, (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000), 0);
      return { label: `${v.make} ${v.model} (${v.licensePlate})`, caMois: Math.round(caMois), ca6m: Math.round(ca6m), occupancy: Math.min(100, Math.round(totalDays / 180 * 100)), healthScore: v.healthScore ?? 100, rentalCount: vSix.length };
    });

    const defaultSuggestions: AiSuggestion[] = [
      { title: 'Optimiser les photos des véhicules', description: 'Des photos de qualité augmentent le taux de conversion de 30%', type: 'opportunity', priority: 'medium' },
      { title: 'Ajuster les prix selon la saison', description: 'Les tarifs dynamiques permettent d\'optimiser le remplissage et le CA', type: 'opportunity', priority: 'medium' },
      { title: 'Enregistrer vos coûts fixes', description: 'Renseignez vos charges mensuelles (assurance, crédit) pour suivre votre rentabilité réelle', type: 'info', priority: 'low' },
      { title: 'Activer les séquences automatiques', description: 'Les messages automatisés améliorent la satisfaction et réduisent les litiges', type: 'opportunity', priority: 'medium' },
      { title: 'Documenter les entretiens', description: 'Un historique à jour des maintenances préserve la valeur de votre flotte', type: 'info', priority: 'low' },
    ];

    if (vehicleStats.length === 0) {
      res.json({ suggestions: defaultSuggestions });
      return;
    }

    const context = JSON.stringify({ vehicules: vehicleStats, fleetCA: vehicleStats.reduce((s, v) => s + v.caMois, 0), avgOccupancy: vehicleStats.length > 0 ? Math.round(vehicleStats.reduce((s, v) => s + v.occupancy, 0) / vehicleStats.length) : 0, pendingMaintenances: pendingMaints.length, openIncidents });
    console.log('[Suggestions] Données collectées:', context.slice(0, 500));

    if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'IA non disponible' }); return; }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: `Tu es consultant en gestion de flotte automobile. Analyse les données et génère exactement 5 suggestions concrètes et actionnables en JSON. Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou après. Chaque élément : { "title": string (max 60 chars), "description": string (max 150 chars), "type": "alert"|"opportunity"|"info", "priority": "high"|"medium"|"low" }`,
      messages: [{ role: 'user', content: `Données flotte :\n${context}` }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '[]';
    console.log('[Suggestions] Réponse Claude:', raw.slice(0, 500));
    let suggestions: AiSuggestion[] = [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) suggestions = parsed as AiSuggestion[];
      else { console.error('[Suggestions] Réponse non tableau:', raw.slice(0, 200)); suggestions = defaultSuggestions; }
    } catch (parseErr) {
      console.error('[Suggestions] Erreur JSON.parse:', parseErr, '— Raw:', raw.slice(0, 300));
      suggestions = defaultSuggestions;
    }

    suggestionsCache.set(cacheKey, { data: suggestions, ts: Date.now() });
    res.json({ suggestions });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/quality-alerts
router.get('/quality-alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const { getQualityAlerts } = await import('../ai/ai.service');
    const alerts = await getQualityAlerts(db);
    res.json({ alerts });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/mileage-anomalies
router.get('/mileage-anomalies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const { detectMileageAnomalies } = await import('../ai/ai.service');
    const anomalies = await detectMileageAnomalies(db);
    res.json({ anomalies });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/correlation — note Getaround vs taux d'occupation par véhicule/mois
router.get('/correlation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const since = new Date();
    since.setMonth(since.getMonth() - 12);

    const [ratings, vehicles] = await Promise.all([
      db.vehicleRating.findMany({
        where: { period: { gte: since.toISOString().slice(0, 7) } },
        select: { vehicleId: true, period: true, rating: true },
      }),
      db.vehicle.findMany({ where: { isActive: true }, select: { id: true, licensePlate: true, make: true, model: true } }),
    ]);

    const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

    const points: Array<{ vehiclePlate: string; vehicleLabel: string; month: string; rating: number; occupancyRate: number }> = [];

    for (const r of ratings) {
      const [yr, mo] = r.period.split('-').map(Number) as [number, number];
      const from = new Date(yr, mo - 1, 1);
      const to = new Date(yr, mo, 0, 23, 59, 59);
      const daysInMonth = to.getDate();

      const rentals = await db.rental.findMany({
        where: { vehicleId: r.vehicleId, startAt: { gte: from, lte: to }, status: { in: ['active', 'completed'] } },
        select: { startAt: true, endAt: true },
      });

      const occupiedDays = new Set<string>();
      for (const rental of rentals) {
        const s = new Date(rental.startAt);
        const e = rental.endAt ? new Date(rental.endAt) : to;
        for (let d = new Date(s); d <= e && d <= to; d.setDate(d.getDate() + 1)) {
          occupiedDays.add(d.toISOString().slice(0, 10));
        }
      }

      const occupancyRate = Math.round((occupiedDays.size / daysInMonth) * 100);
      const v = vehicleMap.get(r.vehicleId);
      if (v) {
        points.push({
          vehiclePlate: v.licensePlate,
          vehicleLabel: `${v.make} ${v.model} · ${v.licensePlate}`,
          month: r.period,
          rating: r.rating,
          occupancyRate,
        });
      }
    }

    res.json({ points });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/benchmark — données anonymisées flotte (Enterprise, benchmarkConsent)
router.get('/benchmark', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getMasterClient } = await import('../../prisma/client');
    const master = getMasterClient();

    const tenantDbUrl = req.tenantDbUrl!;

    // Toutes les entreprises ayant donné leur consentement
    const companies = await master.company.findMany({
      where: { isActive: true, benchmarkConsent: true },
      select: { tenantDbUrl: true },
    });

    if (companies.length === 0) {
      res.json({ hasData: false, message: 'Aucun tenant ne participe encore au benchmark' });
      return;
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const daysInMonth = monthEnd.getDate();

    const allStats: Array<{ occupancyRate: number; caPerVehicle: number; healthScore: number }> = [];
    let ownStats: { occupancyRate: number; caPerVehicle: number; healthScore: number } | null = null;

    for (const company of companies) {
      const db = getTenantClient(company.tenantDbUrl);
      const [vehicles, rentals] = await Promise.all([
        db.vehicle.findMany({ where: { isActive: true }, select: { id: true, healthScore: true } }),
        db.rental.findMany({
          where: { startAt: { gte: monthStart, lte: monthEnd }, status: { in: ['active', 'completed'] } },
          select: { vehicleId: true, ownerPayout: true, grossRevenue: true, startAt: true, endAt: true },
        }),
      ]);

      const vCount = vehicles.length;
      if (vCount === 0) continue;

      const occupiedDaysByVehicle = new Map<string, Set<string>>();
      let totalCA = 0;
      for (const r of rentals) {
        if (!occupiedDaysByVehicle.has(r.vehicleId)) occupiedDaysByVehicle.set(r.vehicleId, new Set());
        const s = new Date(r.startAt);
        const e = r.endAt ? new Date(r.endAt) : monthEnd;
        for (let d = new Date(s); d <= e && d <= monthEnd; d.setDate(d.getDate() + 1)) {
          occupiedDaysByVehicle.get(r.vehicleId)!.add(d.toISOString().slice(0, 10));
        }
        totalCA += (r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : (r.grossRevenue ?? 0);
      }

      const totalOccupied = [...occupiedDaysByVehicle.values()].reduce((s, d) => s + d.size, 0);
      const occupancyRate = Math.round((totalOccupied / (vCount * daysInMonth)) * 100);
      const caPerVehicle = Math.round(totalCA / vCount);
      const healthScore = Math.round(vehicles.reduce((s, v) => s + v.healthScore, 0) / vCount);

      const stat = { occupancyRate, caPerVehicle, healthScore };
      allStats.push(stat);
      if (company.tenantDbUrl === tenantDbUrl) ownStats = stat;
    }

    if (allStats.length === 0) { res.json({ hasData: false }); return; }

    const sorted = [...allStats].sort((a, b) => a.occupancyRate - b.occupancyRate);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted[mid]!;
    const top = sorted[Math.floor(sorted.length * 0.8)] ?? sorted[sorted.length - 1]!;
    const avg = {
      occupancyRate: Math.round(allStats.reduce((s, a) => s + a.occupancyRate, 0) / allStats.length),
      caPerVehicle: Math.round(allStats.reduce((s, a) => s + a.caPerVehicle, 0) / allStats.length),
      healthScore: Math.round(allStats.reduce((s, a) => s + a.healthScore, 0) / allStats.length),
    };

    res.json({
      hasData: true,
      participantCount: allStats.length,
      own: ownStats,
      median,
      avg,
      top80th: top,
    });
  } catch (err) { next(err); }
});

// GET /api/v1/intelligence/environment — bilan carbone flotte
router.get('/environment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [settings, vehicles, rentals] = await Promise.all([
      db.companySettings.findFirst(),
      db.vehicle.findMany({ where: { isActive: true }, select: { id: true, make: true, model: true, licensePlate: true, fuelType: true } }),
      db.rental.findMany({
        where: { startAt: { gte: monthStart, lte: monthEnd }, status: { in: ['active', 'completed'] } },
        select: { vehicleId: true, kmDriven: true },
      }),
    ]);

    const co2ByFuel: Record<string, number> = {
      essence:    settings?.co2FactorEssence    ?? 120,
      diesel:     settings?.co2FactorEssence    ?? 120, // diesel ≈ essence par défaut
      hybride:    settings?.co2FactorHybride    ?? 60,
      electrique: settings?.co2FactorElectrique ?? 10,
      gpl:        settings?.co2FactorEssence    ?? 120,
    };
    const co2PerArbre = settings?.co2EquivalentArbre ?? 10;

    const fuelMap = new Map(vehicles.map(v => [v.id, v.fuelType ?? 'essence']));
    const labelMap = new Map(vehicles.map(v => [v.id, `${v.make} ${v.model} · ${v.licensePlate}`]));

    const byVehicle = new Map<string, number>();
    for (const r of rentals) {
      if (!r.kmDriven || r.kmDriven === 0) continue;
      const fuel = fuelMap.get(r.vehicleId) ?? 'essence';
      const facteur = co2ByFuel[fuel] ?? 120;
      const co2g = r.kmDriven * facteur;
      byVehicle.set(r.vehicleId, (byVehicle.get(r.vehicleId) ?? 0) + co2g);
    }

    const totalCo2Kg = [...byVehicle.values()].reduce((s, g) => s + g / 1000, 0);
    const equivalentArbres = totalCo2Kg / co2PerArbre;

    const vehicleData = [...byVehicle.entries()].map(([vehicleId, co2g]) => ({
      vehicleId,
      label: labelMap.get(vehicleId) ?? vehicleId,
      co2Kg: Math.round(co2g / 100) / 10,
    })).sort((a, b) => b.co2Kg - a.co2Kg);

    res.json({
      monthStart: monthStart.toISOString(),
      totalCo2Kg: Math.round(totalCo2Kg * 10) / 10,
      equivalentArbres: Math.round(equivalentArbres * 10) / 10,
      byVehicle: vehicleData,
      facteurs: { essence: co2ByFuel.essence, hybride: co2ByFuel.hybride, electrique: co2ByFuel.electrique, co2PerArbre },
    });
  } catch (err) { next(err); }
});

// Rapport CEO — monté ici pour éviter le double plan-gating depuis app.ts
router.use('/report', reportRouter);

// GET /api/v1/intelligence/patterns — heatmap jours/heure + insights
router.get('/patterns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const since = new Date();
    since.setMonth(since.getMonth() - 12);

    const rentals = await db.rental.findMany({
      where: {
        startAt: { gte: since },
        status: { in: ['completed', 'active', 'booked'] },
      },
      select: { startAt: true, endAt: true, grossRevenue: true, ownerPayout: true },
    });

    const FR_DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const parJour: { day: string; count: number; ca: number }[] = FR_DAYS.map(day => ({ day, count: 0, ca: 0 }));
    const parTranche: { heure: string; count: number }[] = Array.from({ length: 24 }, (_, h) => ({ heure: `${h}h`, count: 0 }));
    const dureesParJour: Record<number, { total: number; count: number }> = {};

    for (const r of rentals) {
      const start = new Date(r.startAt);
      const dayIdx = start.getDay();
      const hour = start.getHours();
      const payout = (r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : Math.max(0, r.grossRevenue ?? 0);
      parJour[dayIdx].count++;
      parJour[dayIdx].ca += payout;
      parTranche[hour].count++;
      const dureeJours = r.endAt ? Math.max(0, (new Date(r.endAt).getTime() - start.getTime()) / 86_400_000) : 0;
      if (!dureesParJour[dayIdx]) dureesParJour[dayIdx] = { total: 0, count: 0 };
      dureesParJour[dayIdx].total += dureeJours;
      dureesParJour[dayIdx].count++;
    }

    const dureeMoyParJour = FR_DAYS.map((day, i) => ({
      day,
      dureeMoy: dureesParJour[i] && dureesParJour[i].count > 0
        ? Math.round((dureesParJour[i].total / dureesParJour[i].count) * 10) / 10
        : 0,
    }));

    const topDay = [...parJour].sort((a, b) => b.count - a.count)[0];
    const topHour = [...parTranche].sort((a, b) => b.count - a.count)[0];
    const weekendTotal = parJour[0].count + parJour[6].count;
    const tauxWeekend = rentals.length > 0 ? Math.round((weekendTotal / rentals.length) * 100) : 0;
    const totalDays = Object.values(dureesParJour).reduce((s, v) => s + v.total, 0);
    const avgDuree = rentals.length > 0 ? Math.round((totalDays / rentals.length) * 10) / 10 : 0;

    const insights = [
      { label: 'Jour préféré', value: `${topDay?.day ?? '—'} (${topDay?.count ?? 0} dép.)`, icon: '📅' },
      { label: 'Heure de pointe', value: `${topHour?.heure ?? '—'} (${topHour?.count ?? 0})`, icon: '⏰' },
      { label: 'Taux week-end', value: `${tauxWeekend}%`, icon: '🗓️' },
      { label: 'Durée moyenne', value: `${avgDuree}j`, icon: '⏱️' },
    ];

    res.json({
      parJour: parJour.map(d => ({ ...d, ca: Math.round(d.ca * 100) / 100 })),
      parTranche,
      dureeMoyParJour,
      insights,
    });
  } catch (err) { next(err); }
});

export default router;
