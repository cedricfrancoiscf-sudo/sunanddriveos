import { type PrismaClient } from '../../generated/tenant';

export interface RoiDataPoint {
  mois: number;
  roi: number;
  valeurMarchande: number;
  plusValue: number;
  couts: number;
  capitalRestant: number;
  caCumule: number;
}

export interface RoiAnalysis {
  roiActuel: number;
  roiMax: number;
  moisOptimal: number;
  dateOptimale: string;
  plusValueNette: number;
  capitalRestantDu: number;
  signal: 'vendre_maintenant' | 'bientot' | 'attendre' | 'optimal';
  courbe: RoiDataPoint[];
  caMensuelMoyen: number;
  coutsMensuelsTotaux: number;
}

type Db = ReturnType<typeof import('../../prisma/client').getTenantClient>;

interface RoiSettings {
  depreciationRateYear1: number;
  depreciationRateYear2: number;
  depreciationRateYear3: number;
  depreciationRateYears4to6: number;
  depreciationRateAfter6: number;
  majorMaintenanceCost: number;
  majorMaintenanceKm: number;
  roiAlertMonthsBefore: number;
}

const DEFAULT_SETTINGS: RoiSettings = {
  depreciationRateYear1: 0.20,
  depreciationRateYear2: 0.15,
  depreciationRateYear3: 0.12,
  depreciationRateYears4to6: 0.10,
  depreciationRateAfter6: 0.08,
  majorMaintenanceCost: 1500,
  majorMaintenanceKm: 30000,
  roiAlertMonthsBefore: 6,
};

function getAnnualDepreciationRate(ageYears: number, s: RoiSettings): number {
  if (ageYears < 1) return s.depreciationRateYear1;
  if (ageYears < 2) return s.depreciationRateYear2;
  if (ageYears < 3) return s.depreciationRateYear3;
  if (ageYears <= 6) return s.depreciationRateYears4to6;
  return s.depreciationRateAfter6;
}

function loanRemainingBalance(principal: number, annualRatePct: number, totalMonths: number, elapsedMonths: number): number {
  if (elapsedMonths >= totalMonths) return 0;
  if (annualRatePct === 0) {
    return Math.max(0, principal - (principal / totalMonths) * elapsedMonths);
  }
  const r = annualRatePct / 100 / 12;
  const pmt = principal * (r * Math.pow(1 + r, totalMonths)) / (Math.pow(1 + r, totalMonths) - 1);
  return Math.max(0, pmt * (1 - Math.pow(1 + r, -(totalMonths - elapsedMonths))) / r);
}

export async function calculateOptimalSaleWindow(vehicleId: string, db: Db): Promise<RoiAnalysis | null> {
  const [vehicle, settings, fixedCosts, maintenances] = await Promise.all([
    db.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        purchasePrice: true,
        purchaseDate: true,
        loanAmount: true,
        loanRate: true,
        loanDurationMonths: true,
        loanStartDate: true,
        marketValue: true,
        currentMileage: true,
        year: true,
      },
    }),
    db.companySettings.findFirst({
      select: {
        depreciationRateYear1: true,
        depreciationRateYear2: true,
        depreciationRateYear3: true,
        depreciationRateYears4to6: true,
        depreciationRateAfter6: true,
        majorMaintenanceCost: true,
        majorMaintenanceKm: true,
        roiAlertMonthsBefore: true,
      },
    }),
    db.vehicleCost.findMany({
      where: { vehicleId, type: 'fixed' },
      select: { amount: true },
    }),
    db.maintenance.findMany({
      where: {
        vehicleId,
        performedAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
        cost: { not: null },
      },
      select: { cost: true },
    }),
  ]);

  if (!vehicle?.purchasePrice || !vehicle.marketValue || !vehicle.purchaseDate) return null;

  const s: RoiSettings = settings
    ? {
        depreciationRateYear1: settings.depreciationRateYear1,
        depreciationRateYear2: settings.depreciationRateYear2,
        depreciationRateYear3: settings.depreciationRateYear3,
        depreciationRateYears4to6: settings.depreciationRateYears4to6,
        depreciationRateAfter6: settings.depreciationRateAfter6,
        majorMaintenanceCost: settings.majorMaintenanceCost,
        majorMaintenanceKm: settings.majorMaintenanceKm,
        roiAlertMonthsBefore: settings.roiAlertMonthsBefore,
      }
    : DEFAULT_SETTINGS;

  // CA mensuel moyen — somme des 6 derniers mois / 6 (mois sans location = 0)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const rentals = await db.rental.findMany({
    where: { vehicleId, startAt: { gte: sixMonthsAgo } },
    select: { ownerPayout: true },
  });
  const totalCa6 = rentals.reduce((sum, r) => sum + (r.ownerPayout ?? 0), 0);
  const caMensuelMoyen = totalCa6 / 6;

  // Coûts fixes mensuels
  const fixedMonthly = fixedCosts.reduce((sum, c) => sum + c.amount, 0);

  // Coûts variables mensuels (entretien, moyenne 12 mois)
  const totalMaintCost = maintenances.reduce((sum, m) => sum + (m.cost ?? 0), 0);
  const variableMonthly = maintenances.length > 0 ? totalMaintCost / 12 : 0;

  const coutsMensuelsTotaux = fixedMonthly + variableMonthly;

  const now = new Date();
  const purchaseDate = new Date(vehicle.purchaseDate);
  const currentAgeMonths = Math.max(1, Math.floor(
    (now.getTime() - purchaseDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000),
  ));

  // Âge réel depuis l'année de fabrication (pas depuis la date d'achat)
  const realAgeYears = vehicle.year
    ? Math.max(0, now.getFullYear() - vehicle.year)
    : Math.floor((now.getTime() - purchaseDate.getTime()) / (365.25 * 86_400_000));

  const loanStartDate = vehicle.loanStartDate ? new Date(vehicle.loanStartDate) : purchaseDate;
  const loanElapsedBase = Math.floor(
    (now.getTime() - loanStartDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000),
  );

  const avgMonthlyKm = vehicle.currentMileage > 0 ? vehicle.currentMileage / currentAgeMonths : 1000;
  const baseMajorCount = Math.floor(vehicle.currentMileage / s.majorMaintenanceKm);

  const courbe: RoiDataPoint[] = [];
  let currentValue = vehicle.marketValue;
  let maxRoi = -Infinity;
  let moisOptimal = 0;

  for (let m = 0; m <= 84; m++) {
    if (m > 0) {
      // Âge réel + projection mois par mois → la tranche évolue automatiquement
      const ageYears = realAgeYears + m / 12;
      const annualRate = getAnnualDepreciationRate(ageYears, s);
      currentValue = currentValue * (1 - annualRate / 12);
    }

    const loanElapsed = loanElapsedBase + m;
    const capitalRestant =
      vehicle.loanAmount && vehicle.loanRate !== null && vehicle.loanDurationMonths
        ? loanRemainingBalance(vehicle.loanAmount, vehicle.loanRate ?? 0, vehicle.loanDurationMonths, loanElapsed)
        : 0;

    const caCumule = caMensuelMoyen * m;

    const kmAtM = vehicle.currentMileage + avgMonthlyKm * m;
    const majorCount = Math.floor(kmAtM / s.majorMaintenanceKm) - baseMajorCount;
    const coutsCumules = coutsMensuelsTotaux * m + Math.max(0, majorCount) * s.majorMaintenanceCost;

    const plusValue = currentValue - capitalRestant;
    const roi = ((caCumule - coutsCumules + plusValue) / vehicle.purchasePrice) * 100;

    courbe.push({
      mois: m,
      roi: Math.round(roi * 100) / 100,
      valeurMarchande: Math.round(currentValue),
      plusValue: Math.round(plusValue),
      couts: Math.round(coutsCumules),
      capitalRestant: Math.round(capitalRestant),
      caCumule: Math.round(caCumule),
    });

    if (roi > maxRoi) {
      maxRoi = roi;
      moisOptimal = m;
    }
  }

  // Prêt encore en cours sur la fenêtre 84 mois ?
  const moisFinPret = vehicle.loanDurationMonths
    ? Math.max(0, vehicle.loanDurationMonths - loanElapsedBase)
    : 0;
  const pretEncoreEnCours = moisFinPret > 0 && moisFinPret <= 84;

  let signal: RoiAnalysis['signal'];
  if (moisOptimal === 0 && !pretEncoreEnCours) {
    // ROI ne remonte jamais ET prêt déjà soldé → vendre maintenant
    signal = 'vendre_maintenant';
  } else if (moisOptimal > 0 && moisOptimal <= s.roiAlertMonthsBefore) {
    signal = 'bientot';
  } else if (moisOptimal > 0 && moisOptimal <= 24) {
    signal = 'optimal';
  } else {
    signal = 'attendre';
  }

  const dateOptimale = new Date();
  dateOptimale.setMonth(dateOptimale.getMonth() + moisOptimal);
  const dateStr = `${dateOptimale.getFullYear()}-${String(dateOptimale.getMonth() + 1).padStart(2, '0')}`;

  return {
    roiActuel: courbe[0].roi,
    roiMax: Math.round(maxRoi * 100) / 100,
    moisOptimal,
    dateOptimale: dateStr,
    plusValueNette: courbe[0].plusValue,
    capitalRestantDu: courbe[0].capitalRestant,
    signal,
    courbe,
    caMensuelMoyen: Math.round(caMensuelMoyen),
    coutsMensuelsTotaux: Math.round(coutsMensuelsTotaux),
  };
}
