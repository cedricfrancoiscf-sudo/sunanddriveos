import { type PrismaClient } from '../../generated/tenant';

export interface RoiDataPoint {
  mois: number;
  roi: number;
  valeurMarchande: number;
  plusValue: number;
  couts: number;
  capitalRestant: number;
  caCumule: number;
  dateLabel: string;
  estHistorique: boolean;
  estAujourdhui: boolean;
  hasSnapshot: boolean;
  cashflow: number;
  cashflowCumule: number;
  mensualite: number;
  totalSortiDePoche: number;
  cocReturn: number | null;
  tri: number | null;
  caReel: number;
}

export interface RoiAnalysis {
  roiActuel: number;
  roiMax: number;
  moisOptimal: number;
  moisRestants: number;
  dateOptimale: string;
  plusValueNette: number;
  capitalRestantDu: number;
  signal: 'vendre_maintenant' | 'bientot' | 'attendre' | 'optimal';
  courbe: RoiDataPoint[];
  caMensuelMoyen: number;
  coutsMensuelsTotaux: number;
  mensualitePret: number;
  loanDeposit: number;
  caMensuelNormalise: number;
  caParMoisCalendaire: number[];
  triActuel: number | null;
  triMax: number | null;
  moisOptimalTri: number;
  cocActuel: number | null;
  cocMax: number | null;
  cashflowMensuelNet: number;
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
  roiCaMoyenMois: number;
  roiHorizonMonths: number;
  roiCoeffSaison: number[] | null;
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
  roiCaMoyenMois: 5,
  roiHorizonMonths: 48,
  roiCoeffSaison: null,
};

function getAnnualDepreciationRate(ageYears: number, s: RoiSettings): number {
  if (ageYears < 1) return s.depreciationRateYear1;
  if (ageYears < 2) return s.depreciationRateYear2;
  if (ageYears < 3) return s.depreciationRateYear3;
  if (ageYears <= 6) return s.depreciationRateYears4to6;
  return s.depreciationRateAfter6;
}

function loanRemainingBalance(
  principal: number,
  annualRatePct: number,
  totalMonths: number,
  elapsedMonths: number,
): number {
  if (elapsedMonths >= totalMonths) return 0;
  if (annualRatePct === 0) {
    return Math.max(0, principal - (principal / totalMonths) * elapsedMonths);
  }
  const r = annualRatePct / 100 / 12;
  const pmt = (principal * (r * Math.pow(1 + r, totalMonths))) / (Math.pow(1 + r, totalMonths) - 1);
  return Math.max(0, (pmt * (1 - Math.pow(1 + r, -(totalMonths - elapsedMonths)))) / r);
}

export async function calculateOptimalSaleWindow(vehicleId: string, db: Db): Promise<RoiAnalysis | null> {
  const now = new Date();

  // 2A : fixedCosts filtrés sur coûts actifs aujourd'hui (start ≤ today AND (end IS NULL OR end > today))
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
        loanDeposit: true,
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
        roiCaMoyenMois: true,
        roiHorizonMonths: true,
        roiCoeffSaison: true,
      },
    }),
    db.vehicleCost.findMany({
      where: {
        vehicleId,
        type: 'fixed',
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gt: now } }],
      },
      select: { amount: true, startDate: true, endDate: true },
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

  const purchaseDate = new Date(vehicle.purchaseDate);

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
        roiCaMoyenMois: settings.roiCaMoyenMois ?? 5,
        roiHorizonMonths: settings.roiHorizonMonths ?? 48,
        roiCoeffSaison: Array.isArray(settings.roiCoeffSaison) ? (settings.roiCoeffSaison as number[]) : null,
      }
    : DEFAULT_SETTINGS;

  // 2D : horizon configurable
  const TOTAL_MONTHS = s.roiHorizonMonths;

  // Fenêtre caMensuelMoyen — mois complets, exclure le mois en cours
  const debutMoisEnCours = new Date(now.getFullYear(), now.getMonth(), 1);
  const moisDepuisAchat = Math.floor(
    (debutMoisEnCours.getTime() - purchaseDate.getTime()) / (30.44 * 86_400_000),
  );
  const nbMoisEffectifs = Math.max(1, Math.min(s.roiCaMoyenMois, moisDepuisAchat));
  const debutFenetre = new Date(debutMoisEnCours);
  debutFenetre.setMonth(debutFenetre.getMonth() - nbMoisEffectifs);

  // 2A : fixedMonthly calculé sur les coûts actifs uniquement (filtrés en DB)
  const fixedMonthly = fixedCosts.reduce((sum, c) => sum + c.amount, 0);
  const totalMaintCost = maintenances.reduce((sum, m) => sum + (m.cost ?? 0), 0);
  const variableMonthly = maintenances.length > 0 ? totalMaintCost / 12 : 0;
  const coutsMensuelsTotaux = fixedMonthly + variableMonthly;

  const [allRentals, valuations, allCosts] = await Promise.all([
    db.rental.findMany({
      where: {
        vehicleId,
        startAt: { gte: purchaseDate },
        status: { in: ['completed', 'booked', 'active'] },
      },
      select: { ownerPayout: true, grossRevenue: true, startAt: true, endAt: true },
      orderBy: { startAt: 'asc' },
    }),
    db.vehicleValuation.findMany({
      where: { vehicleId },
      orderBy: { evaluatedAt: 'asc' },
    }),
    db.vehicleCost.findMany({
      where: { vehicleId },
      select: { amount: true, type: true, startDate: true, endDate: true, amortizationMonths: true },
    }),
  ]);

  // caMensuelMoyen sur la fenêtre de mois complets
  const rentalsCA = allRentals.filter(
    (r) => r.endAt && new Date(r.endAt) >= debutFenetre && new Date(r.endAt) < debutMoisEnCours,
  );
  const totalCAFenetre = rentalsCA.reduce(
    (sum, r) => sum + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)),
    0,
  );
  const caMensuelMoyen = totalCAFenetre / nbMoisEffectifs;

  // Âge réel depuis l'année de fabrication à la date d'achat
  const realAgeYears = vehicle.year ? Math.max(0, purchaseDate.getFullYear() - vehicle.year) : 0;

  const loanStartDate = vehicle.loanStartDate ? new Date(vehicle.loanStartDate) : purchaseDate;
  const loanElapsedBase = Math.max(
    0,
    Math.floor((purchaseDate.getTime() - loanStartDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000)),
  );

  const loanR = (vehicle.loanRate ?? 0) / 100 / 12;
  const pmt =
    vehicle.loanAmount && vehicle.loanDurationMonths
      ? loanR > 0
        ? (vehicle.loanAmount * (loanR * Math.pow(1 + loanR, vehicle.loanDurationMonths))) /
          (Math.pow(1 + loanR, vehicle.loanDurationMonths) - 1)
        : vehicle.loanAmount / vehicle.loanDurationMonths
      : 0;

  const moisActuel = Math.min(
    TOTAL_MONTHS,
    Math.floor((now.getTime() - purchaseDate.getTime()) / (30.44 * 86_400_000)),
  );

  // 2E : profil saisonnier — réel si dispo, sinon coeff saisonnier, sinon moyenne plate
  const caParMoisCalendaire = new Array<number>(12).fill(0);
  const countParMois = new Array<number>(12).fill(0);
  for (const r of allRentals) {
    if (!r.endAt) continue;
    const endDate = new Date(r.endAt);
    if (endDate >= debutMoisEnCours || endDate < debutFenetre) continue;
    const idx = endDate.getMonth();
    const ca = (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0);
    caParMoisCalendaire[idx] += ca;
    countParMois[idx]++;
  }
  for (let i = 0; i < 12; i++) {
    if (countParMois[i] > 0) {
      caParMoisCalendaire[i] = caParMoisCalendaire[i] / countParMois[i];
    } else {
      const coeff = s.roiCoeffSaison?.[i] ?? null;
      caParMoisCalendaire[i] = coeff != null ? caMensuelMoyen * coeff : caMensuelMoyen;
    }
  }

  // CA réel par mois depuis purchaseDate
  const caReelParMois = new Array<number>(TOTAL_MONTHS + 1).fill(0);
  for (let m = 0; m <= moisActuel; m++) {
    const mStart = new Date(purchaseDate);
    mStart.setMonth(mStart.getMonth() + m);
    mStart.setDate(1);
    mStart.setHours(0, 0, 0, 0);
    const mEnd = new Date(mStart);
    mEnd.setMonth(mEnd.getMonth() + 1);
    caReelParMois[m] = allRentals
      .filter((r) => r.endAt && new Date(r.endAt) >= mStart && new Date(r.endAt) < mEnd)
      .reduce(
        (acc, r) => acc + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)),
        0,
      );
  }

  // Coûts réels par mois depuis purchaseDate
  const coutsReelParMois = new Array<number>(TOTAL_MONTHS + 1).fill(0);
  for (let m = 0; m <= moisActuel; m++) {
    const mDate = new Date(purchaseDate);
    mDate.setMonth(mDate.getMonth() + m);
    let c = 0;
    for (const cost of allCosts) {
      const start = new Date(cost.startDate);
      const end = cost.endDate ? new Date(cost.endDate) : null;
      if (mDate < start) continue;
      if (end && mDate >= end) continue;
      if (cost.type === 'fixed') {
        c += cost.amount;
      } else if (cost.type === 'onetime' && cost.amortizationMonths) {
        c += cost.amount / cost.amortizationMonths;
      }
    }
    coutsReelParMois[m] = c;
  }

  function calculerTRI(flux: number[]): number | null {
    if (flux.length < 2) return null;
    if (!flux.some((f) => f < 0) || !flux.some((f) => f > 0)) return null;
    const npv = (r: number) => flux.reduce((acc, f, i) => acc + f / Math.pow(1 + r, i), 0);
    let lo = -0.9999;
    let hi = 10.0;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid;
      else hi = mid;
    }
    const triMensuel = (lo + hi) / 2;
    return Math.round((Math.pow(1 + triMensuel, 12) - 1) * 10000) / 100;
  }

  const loanDeposit = vehicle.loanDeposit ?? 0;
  // 2C : TRI calculable uniquement si apport personnel renseigné
  const triCalculable = loanDeposit > 0;

  let currentValue = vehicle.purchasePrice!;
  let cashflowCumule = 0;
  let maxRoi = -Infinity;
  let moisOptimal = 0;
  let maxTri: number | null = null;
  let moisOptimalTri = 0;
  let maxCoc: number | null = null;
  const fluxTri: number[] = triCalculable ? [-loanDeposit] : [];
  const courbe: RoiDataPoint[] = [];

  for (let m = 0; m <= TOTAL_MONTHS; m++) {
    const mDate = new Date(purchaseDate);
    mDate.setMonth(mDate.getMonth() + m);

    const snapshot = valuations.find((v) => {
      const diff = Math.abs(new Date(v.evaluatedAt).getTime() - mDate.getTime());
      return diff < 15 * 86_400_000;
    });
    if (m === 0) {
      currentValue = snapshot?.estimatedValue ?? vehicle.purchasePrice!;
    } else if (snapshot) {
      currentValue = snapshot.estimatedValue;
    } else {
      const ageYears = realAgeYears + m / 12;
      const rate = getAnnualDepreciationRate(ageYears, s);
      currentValue = currentValue * (1 - rate / 12);
    }

    const loanElapsed = loanElapsedBase + m;
    const capitalRestant =
      vehicle.loanAmount && vehicle.loanRate !== null && vehicle.loanDurationMonths
        ? loanRemainingBalance(vehicle.loanAmount, vehicle.loanRate ?? 0, vehicle.loanDurationMonths, loanElapsed)
        : 0;

    const mensualite = loanElapsed < (vehicle.loanDurationMonths ?? 0) ? pmt : 0;

    const estHistorique = m <= moisActuel;
    const moisCal = (purchaseDate.getMonth() + m) % 12;
    const caM = estHistorique ? caReelParMois[m] : caParMoisCalendaire[moisCal];
    const coutsM = estHistorique ? coutsReelParMois[m] : coutsMensuelsTotaux;

    const cashflow = caM - coutsM - mensualite;
    if (m > 0) cashflowCumule += cashflow;

    const totalSortiDePoche = loanDeposit + pmt * Math.min(loanElapsed, vehicle.loanDurationMonths ?? 0);
    const plusValue = currentValue - capitalRestant;

    let caCumule = 0;
    let coutsCumules = 0;
    for (let i = 0; i <= m; i++) {
      const ci = (purchaseDate.getMonth() + i) % 12;
      caCumule += i <= moisActuel ? caReelParMois[i] : caParMoisCalendaire[ci];
      coutsCumules += i <= moisActuel ? coutsReelParMois[i] : coutsMensuelsTotaux;
    }

    const roi = ((caCumule - coutsCumules + plusValue) / vehicle.purchasePrice!) * 100;

    const cocReturn =
      totalSortiDePoche > 0
        ? Math.round(((cashflowCumule + plusValue - totalSortiDePoche) / totalSortiDePoche) * 10000) / 100
        : null;

    // 2C : TRI uniquement si apport renseigné
    let tri: number | null = null;
    if (triCalculable && m > 0) {
      const fluxRevente = [...fluxTri, cashflow + plusValue];
      tri = calculerTRI(fluxRevente);
    }
    if (triCalculable && m > 0) fluxTri.push(cashflow);

    const dateLabel = mDate.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });

    courbe.push({
      mois: m,
      roi: Math.round(roi * 100) / 100,
      valeurMarchande: Math.round(currentValue),
      plusValue: Math.round(plusValue),
      couts: Math.round(coutsCumules),
      capitalRestant: Math.round(capitalRestant),
      caCumule: Math.round(caCumule),
      dateLabel,
      estHistorique,
      estAujourdhui: m === moisActuel,
      hasSnapshot: Boolean(snapshot),
      cashflow: Math.round(cashflow),
      cashflowCumule: Math.round(cashflowCumule),
      mensualite: Math.round(mensualite),
      totalSortiDePoche: Math.round(totalSortiDePoche),
      cocReturn,
      tri,
      caReel: Math.round(caM),
    });

    if (roi > maxRoi) { maxRoi = roi; moisOptimal = m; }
    if (tri !== null && (maxTri === null || tri > maxTri)) { maxTri = tri; moisOptimalTri = m; }
    if (cocReturn !== null && (maxCoc === null || cocReturn > maxCoc)) maxCoc = cocReturn;
  }

  const moisOptimalFinal = maxTri !== null ? moisOptimalTri : moisOptimal;
  const moisRestants = Math.max(0, moisOptimalFinal - moisActuel);

  const loanElapsedNow = loanElapsedBase + moisActuel;
  const moisFinPret = vehicle.loanDurationMonths
    ? Math.max(0, vehicle.loanDurationMonths - loanElapsedNow)
    : 0;
  const pretEncoreEnCours = moisFinPret > 0 && moisFinPret <= TOTAL_MONTHS;

  // 2B : logique signal corrigée (moisRestants=0 + prêt en cours → bientot)
  let signal: RoiAnalysis['signal'];
  if (moisRestants === 0 && !pretEncoreEnCours) {
    signal = 'vendre_maintenant';
  } else if (moisRestants === 0 && pretEncoreEnCours) {
    signal = 'bientot';
  } else if (moisRestants <= s.roiAlertMonthsBefore) {
    signal = 'bientot';
  } else if (moisRestants <= 24) {
    signal = 'optimal';
  } else {
    signal = 'attendre';
  }

  const dateOpt = new Date(purchaseDate);
  dateOpt.setMonth(dateOpt.getMonth() + moisOptimalFinal);
  const dateStr = `${dateOpt.getFullYear()}-${String(dateOpt.getMonth() + 1).padStart(2, '0')}`;

  const actuPoint = courbe[moisActuel];

  return {
    roiActuel: actuPoint?.roi ?? courbe[0].roi,
    roiMax: Math.round(maxRoi * 100) / 100,
    moisOptimal: moisOptimalFinal,
    moisRestants,
    dateOptimale: dateStr,
    plusValueNette: actuPoint?.plusValue ?? courbe[0].plusValue,
    capitalRestantDu: actuPoint?.capitalRestant ?? courbe[0].capitalRestant,
    signal,
    courbe,
    caMensuelMoyen: Math.round(caMensuelMoyen),
    coutsMensuelsTotaux: Math.round(coutsMensuelsTotaux),
    mensualitePret: Math.round(pmt),
    loanDeposit,
    caMensuelNormalise: Math.round(caMensuelMoyen),
    caParMoisCalendaire: caParMoisCalendaire.map((v) => Math.round(v)),
    // 2C : triActuel null si apport non renseigné
    triActuel: triCalculable ? (actuPoint?.tri ?? null) : null,
    triMax: triCalculable && maxTri !== null ? Math.round(maxTri * 100) / 100 : null,
    moisOptimalTri,
    cocActuel: actuPoint?.cocReturn ?? null,
    cocMax: maxCoc !== null ? Math.round(maxCoc * 100) / 100 : null,
    cashflowMensuelNet: Math.round(caMensuelMoyen - coutsMensuelsTotaux - pmt),
  };
}
