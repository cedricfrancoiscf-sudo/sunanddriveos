import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import Anthropic from '@anthropic-ai/sdk';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ──────────────────────────────────────────────────────────────────

const FR_MONTHS_DATA = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function getMonthPeriod(monthStr: string, delta: number): { label: string; start: Date; end: Date } {
  const [y, mo] = monthStr.split('-').map(Number);
  const d = new Date(y!, mo! - 1 + delta, 1);
  return {
    label: `${FR_MONTHS_DATA[d.getMonth()]} ${d.getFullYear()}`,
    start: new Date(d.getFullYear(), d.getMonth(), 1),
    end:   new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}

function evolPct(current: number, prev: number): number {
  return prev > 0 ? Math.round((current - prev) / prev * 100) : 0;
}

// ── Collecte données annuelles ────────────────────────────────────────────────

async function collectTenantData(db: ReturnType<typeof getTenantClient>) {
  const now = new Date();
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);
  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);
  const nextMonth = new Date(Date.now() + 30 * 86_400_000);

  const [settings, vehicles, rentals, incidents, maintenances, technicalControls, carSeatRequests, vehicleCosts] = await Promise.all([
    db.companySettings.findFirst({
      select: { primaryColor: true, fontFamily: true, logoUrl: true, senderName: true },
    }),
    db.vehicle.findMany({
      where: { isActive: true },
      select: { id: true, make: true, model: true, licensePlate: true, year: true,
                currentMileage: true, healthScore: true, parkingZone: true,
                deliveryPointName: true, deliveryPostalCode: true, fuelType: true },
    }),
    db.rental.findMany({
      where: { startAt: { gte: oneYearAgo }, status: { notIn: ['cancelled'] } },
      select: { vehicleId: true, startAt: true, endAt: true, status: true,
                ownerPayout: true, grossRevenue: true, insuranceFee: true,
                basePrice: true, extraDistanceFee: true, kmDriven: true,
                gasRefillFee: true, lateReturnFee: true, driverMessFee: true,
                damageCompensation: true,
                vehicle: { select: { parkingZone: true, deliveryPointName: true } } },
    }),
    db.incident.findMany({
      where: { createdAt: { gte: oneYearAgo } },
      select: { vehicleId: true, type: true, cost: true, createdAt: true },
    }),
    db.maintenance.findMany({
      where: { nextServiceDate: { lte: nextMonth } },
      select: { vehicleId: true, type: true, cost: true, nextServiceDate: true,
                vehicle: { select: { make: true, model: true, licensePlate: true } } },
    }),
    db.technicalControl.findMany({
      where: { expiryAt: { lte: new Date(Date.now() + 90 * 86_400_000) }, archived: false },
      select: { vehicleId: true, expiryAt: true, result: true, cost: true,
                vehicle: { select: { make: true, model: true, licensePlate: true } } },
    }),
    db.carSeatRequest.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { vehicleId: true, status: true, createdAt: true,
                vehicle: { select: { parkingZone: true, deliveryPointName: true } } },
    }),
    db.vehicleCost.findMany({ select: { vehicleId: true, amount: true, type: true } }),
  ]);

  const totalCA = rentals.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)), 0);
  const totalGross = rentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);

  const monthlyCA: Record<string, number> = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthlyCA[d.toISOString().slice(0, 7)] = 0;
  }
  rentals.forEach(r => {
    const key = new Date(r.startAt).toISOString().slice(0, 7);
    if (key in monthlyCA) monthlyCA[key] += (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0);
  });

  const zoneStats: Record<string, { ca: number; count: number; carSeats: number }> = {};
  rentals.forEach(r => {
    const zone = r.vehicle?.deliveryPointName ?? r.vehicle?.parkingZone ?? 'Non définie';
    if (!zoneStats[zone]) zoneStats[zone] = { ca: 0, count: 0, carSeats: 0 };
    zoneStats[zone].ca += (r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0);
    zoneStats[zone].count++;
  });
  carSeatRequests.forEach(r => {
    const zone = r.vehicle?.deliveryPointName ?? r.vehicle?.parkingZone ?? 'Non définie';
    if (!zoneStats[zone]) zoneStats[zone] = { ca: 0, count: 0, carSeats: 0 };
    zoneStats[zone].carSeats++;
  });

  const daysInPeriod = 180;
  const bookedDays = rentals
    .filter(r => new Date(r.startAt) >= sixMonthsAgo)
    .reduce((s, r) => s + Math.min(daysInPeriod,
      Math.ceil((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000)), 0);
  const occupancyRate = vehicles.length > 0
    ? Math.round(bookedDays / (vehicles.length * daysInPeriod) * 100) : 0;

  const totalFixedCostsMonthly = vehicleCosts.filter(c => c.type === 'fixed').reduce((s, c) => s + c.amount, 0);
  const totalVariableCostsMonthly = vehicleCosts.filter(c => c.type !== 'fixed').reduce((s, c) => s + c.amount, 0);
  const totalMonthlyCosts = totalFixedCostsMonthly + totalVariableCostsMonthly;

  const vehicleStats = vehicles.map(v => {
    const vRentals = rentals.filter(r => r.vehicleId === v.id);
    const vCA = vRentals.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)), 0);
    const vKm = vRentals.reduce((s, r) => s + (r.kmDriven ?? 0), 0);
    const vIncidents = incidents.filter(i => i.vehicleId === v.id).length;
    const vMaint = maintenances.filter(m => m.vehicleId === v.id);
    const vCT = technicalControls.filter(ct => ct.vehicleId === v.id);
    const vVehicleCosts = vehicleCosts.filter(c => c.vehicleId === v.id);
    const vFixedMonthly = vVehicleCosts.filter(c => c.type === 'fixed').reduce((s, c) => s + c.amount, 0);
    const vVariableMonthly = vVehicleCosts.filter(c => c.type !== 'fixed').reduce((s, c) => s + c.amount, 0);
    const vCostsAnnuels = vFixedMonthly * 12 + vVariableMonthly * 12;
    const vMargeAnnuelle = vCA - vCostsAnnuels;
    return {
      vehicule: `${v.make} ${v.model} (${v.licensePlate})`,
      zone: v.deliveryPointName ?? v.parkingZone ?? 'Non définie',
      annee: v.year,
      km: v.currentMileage,
      scoreSante: v.healthScore,
      nbLocations: vRentals.length,
      caNet: Math.round(vCA * 100) / 100,
      kmTotal: vKm,
      kmAnnuelPrevu: Math.round(vKm / (180 / 365)),
      incidents: vIncidents,
      entretiensEnAttente: vMaint.length,
      ctExpiration: vCT.length > 0 ? vCT[0].expiryAt : null,
      coutsMensuels: Math.round((vFixedMonthly + vVariableMonthly) * 100) / 100,
      coutsAnnuels: Math.round(vCostsAnnuels * 100) / 100,
      margeAnnuelle: Math.round(vMargeAnnuelle * 100) / 100,
    };
  });

  const zones = [...new Set(vehicles.map(v => v.deliveryPointName ?? v.parkingZone).filter((z): z is string => Boolean(z)))];

  const totalCostsAnnuels = totalMonthlyCosts * 12;
  const margeNette = totalCA - totalCostsAnnuels;
  const ratioChargesCA = totalCA > 0 ? Math.round(totalMonthlyCosts * 12 / totalCA * 100) : 0;

  const internalContext = {
    periode: '12 derniers mois',
    societe: settings?.senderName ?? 'Sun and Drive',
    flotte: vehicles.length,
    caNet: Math.round(totalCA * 100) / 100,
    caBrut: Math.round(totalGross * 100) / 100,
    tauxOccupation: occupancyRate,
    nbLocations: rentals.length,
    nbIncidents: incidents.length,
    finances: {
      coutsMensuelsTotal: Math.round(totalMonthlyCosts * 100) / 100,
      coutsFixesMensuels: Math.round(totalFixedCostsMonthly * 100) / 100,
      coutsVariablesMensuels: Math.round(totalVariableCostsMonthly * 100) / 100,
      coutsAnnuels: Math.round(totalCostsAnnuels * 100) / 100,
      margeNette: Math.round(margeNette * 100) / 100,
      ratioChargesCA: `${ratioChargesCA}%`,
    },
    vehicules: vehicleStats,
    zoneStats: Object.entries(zoneStats).map(([zone, s]) => ({
      zone, ca: Math.round(s.ca * 100) / 100, count: s.count, carSeats: s.carSeats,
    })),
    interventionsAVenir: maintenances.map(m => ({
      vehicule: `${m.vehicle.make} ${m.vehicle.model} (${m.vehicle.licensePlate})`,
      type: m.type, echeance: m.nextServiceDate,
    })),
    ctExpiration: technicalControls.map(ct => ({
      vehicule: `${ct.vehicle.make} ${ct.vehicle.model} (${ct.vehicle.licensePlate})`,
      expiration: ct.expiryAt,
    })),
    evolutionMensuelle: Object.entries(monthlyCA)
      .map(([mois, ca]) => ({ mois, ca: Math.round(ca * 100) / 100 })),
  };

  return { settings, vehicleStats, zones, internalContext };
}

// ── Génération annuelle asynchrone (exportée pour le cron) ───────────────────

export async function generateCeoReportAsync(
  tenantDbUrl: string,
  reportId: string,
  companyId: string,
  month: string,
): Promise<void> {
  console.log(`[CeoReport] ▶ Début génération — companyId=${companyId} month=${month} reportId=${reportId}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[CeoReport] ✗ ANTHROPIC_API_KEY non définie — génération impossible');
    return;
  }
  const db = getTenantClient(tenantDbUrl);
  try {
    console.log(`[CeoReport] → collectTenantData...`);
    const { settings, vehicleStats, zones, internalContext } = await collectTenantData(db);
    console.log(`[CeoReport] ✓ collectTenantData OK — ${internalContext.flotte} véhicule(s), ${internalContext.nbLocations} location(s), CA net=${internalContext.caNet}`);
    const now = new Date();

    console.log(`[CeoReport] → Appel Claude API (model=claude-sonnet-4-6, max_tokens=8000)...`);
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: `Tu es un analyste stratégique expert en mobilité et location de véhicules entre particuliers.
Tu génères des rapports CEO professionnels, proactifs et actionnables en français.
Tu bases ton analyse sur les données internes réelles fournies.
IMPORTANT : retourne UNIQUEMENT du JSON valide, sans markdown, sans backticks.`,
      messages: [{
        role: 'user',
        content: `Génère un rapport CEO complet pour ${settings?.senderName ?? 'Sun and Drive'}, service de location de voitures Getaround.

DONNÉES INTERNES :
${JSON.stringify(internalContext, null, 2)}

ANALYSE FINANCIÈRE :
- CA net 12 mois : ${internalContext.caNet} €
- Coûts fixes mensuels : ${internalContext.finances.coutsFixesMensuels} € / mois
- Coûts variables mensuels : ${internalContext.finances.coutsVariablesMensuels} € / mois
- Coûts totaux annuels estimés : ${internalContext.finances.coutsAnnuels} €
- Marge nette estimée : ${internalContext.finances.margeNette} €
- Ratio charges/CA : ${internalContext.finances.ratioChargesCA}
${vehicleStats.map(v => `- ${v.vehicule} : CA=${v.caNet}€ / Coûts ann.=${v.coutsAnnuels}€ / Marge=${v.margeAnnuelle}€`).join('\n')}

ZONES DE LIVRAISON : ${zones.join(', ')}

Retourne exactement ce JSON (sans markdown, sans backticks) :
{
  "resume_executif": "3-4 phrases résumant situation et priorités avec chiffres réels",
  "swot": {
    "forces": ["point avec chiffre réel", "point 2", "point 3"],
    "faiblesses": ["point 1", "point 2", "point 3"],
    "opportunites": ["point 1", "point 2", "point 3", "point 4"],
    "menaces": ["point 1", "point 2", "point 3"]
  },
  "pestel": {
    "politique": "2-3 phrases",
    "economique": "2-3 phrases avec chiffres marché",
    "sociologique": "2-3 phrases tendances mobilité",
    "technologique": "2-3 phrases innovations secteur",
    "environnemental": "2-3 phrases réglementation",
    "legal": "2-3 phrases fiscalité 2026"
  },
  "veille_zones": [
    { "zone": "nom exact", "trafic_voyageurs": "données", "perspectives": "projets", "opportunites": "impact", "risques": "vigilance" }
  ],
  "veille_sectorielle": {
    "autopartage": "actualités 2025-2026",
    "ademe": "aides disponibles",
    "fiscalite": "situation 2026",
    "marche": "tendances"
  },
  "recommandations_ceo": [
    { "priorite": "haute", "action": "titre court", "detail": "explication", "echeance": "court terme (1 mois)" }
  ],
  "analyse_accessoires": {
    "demandes_par_zone": [{ "zone": "nom", "demandes_siege": 0, "stock_estime": "suffisant" }],
    "recommandations": ["recommandation 1", "recommandation 2"]
  }
}`,
      }],
    });

    console.log(`[CeoReport] ✓ Réponse Claude reçue — stop_reason=${response.stop_reason} tokens_in=${response.usage.input_tokens} tokens_out=${response.usage.output_tokens}`);
    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[CeoReport] ✗ Réponse Claude non parseable. Extrait (500 chars):', textContent.slice(0, 500));
      throw new Error('Réponse Claude non parseable (pas de JSON détecté)');
    }
    const reportData = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const content = {
      status: 'ready',
      mode: 'annual',
      generatedAt: now.toISOString(),
      theme: {
        primaryColor: settings?.primaryColor ?? '#01696e',
        fontFamily: settings?.fontFamily ?? 'Montserrat',
        logoUrl: settings?.logoUrl ?? null,
        companyName: settings?.senderName ?? 'Sun and Drive',
      },
      internalData: internalContext,
      vehicleStats,
      report: reportData,
    };

    console.log(`[CeoReport] → Mise à jour status='ready' en DB (reportId=${reportId})...`);
    await db.ceoReport.update({
      where: { id: reportId },
      data: { status: 'ready', content: content as never, generatedAt: now },
    });
    console.log(`[CeoReport] ✓ Génération terminée — mois ${month} companyId=${companyId}`);
  } catch (err) {
    console.error(`[CeoReport] ✗ Erreur génération ${month} (${companyId}):`, err);
    try {
      await db.ceoReport.update({ where: { id: reportId }, data: { status: 'error' } });
      console.log(`[CeoReport] → status mis à 'error' en DB`);
    } catch (dbErr) {
      console.error(`[CeoReport] ✗ Impossible de mettre à jour le statut en DB:`, dbErr);
    }
  }
}

// ── Collecte données mensuelles ───────────────────────────────────────────────

async function collectMonthlyData(db: ReturnType<typeof getTenantClient>, monthStr: string) {
  const M  = getMonthPeriod(monthStr,  0);
  const M1 = getMonthPeriod(monthStr, -1);
  const M2 = getMonthPeriod(monthStr, -2);
  const N1 = getMonthPeriod(monthStr, -12);
  const nextM = getMonthPeriod(monthStr, 1);

  const [settings, vehicles, allRentals, ctAlerts, carSeatAlerts, pendingMessages, monthlyVehicleCosts] = await Promise.all([
    db.companySettings.findFirst({
      select: { senderName: true, primaryColor: true, fontFamily: true, logoUrl: true },
    }),
    db.vehicle.findMany({
      where: { isActive: true },
      select: { id: true, make: true, model: true, licensePlate: true },
    }),
    db.rental.findMany({
      where: { status: { notIn: ['cancelled'] }, startAt: { gte: N1.start } },
      select: {
        vehicleId: true, startAt: true, endAt: true,
        ownerPayout: true, grossRevenue: true, kmDriven: true,
      },
    }),
    db.technicalControl.findMany({
      where: { expiryAt: { lte: new Date(Date.now() + 90 * 86_400_000) }, archived: false },
      select: { expiryAt: true, vehicle: { select: { make: true, model: true, licensePlate: true } } },
    }),
    db.carSeatRequest.findMany({
      where: { status: { in: ['pending', 'unavailable'] } },
      select: { id: true },
    }),
    db.message.findMany({
      where: { status: 'pending_approval', direction: 'outbound' },
      select: { id: true },
    }),
    db.vehicleCost.findMany({ select: { amount: true, type: true } }),
  ]);

  const nbVehicles = vehicles.length;

  function rentalsInPeriod(start: Date, end: Date) {
    return allRentals.filter(r => { const s = new Date(r.startAt); return s >= start && s < end; });
  }

  function periodStats(period: { label: string; start: Date; end: Date }) {
    const rs = rentalsInPeriod(period.start, period.end);
    const ca = rs.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)), 0);
    const nbLocations = rs.length;
    const km = rs.reduce((s, r) => s + (r.kmDriven ?? 0), 0);
    const daysInPeriod = Math.ceil((period.end.getTime() - period.start.getTime()) / 86_400_000);
    const bookedDays = rs.reduce((s, r) => {
      const dur = Math.ceil((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000);
      return s + Math.min(dur, daysInPeriod);
    }, 0);
    const tauxOccupation = nbVehicles > 0 ? Math.round(bookedDays / (nbVehicles * daysInPeriod) * 100) : 0;
    return { label: period.label, ca: Math.round(ca * 100) / 100, nbLocations, km, tauxOccupation };
  }

  const mStats  = periodStats(M);
  const m1Stats = periodStats(M1);
  const m2Stats = periodStats(M2);
  const n1Stats = periodStats(N1);

  const mRentals  = rentalsInPeriod(M.start, M.end);
  const m1Rentals = rentalsInPeriod(M1.start, M1.end);
  const daysInM = Math.ceil((M.end.getTime() - M.start.getTime()) / 86_400_000);

  const caParVehicule = vehicles.map(v => {
    const vM  = mRentals.filter(r => r.vehicleId === v.id);
    const vM1 = m1Rentals.filter(r => r.vehicleId === v.id);
    const caM  = vM.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)), 0);
    const caM1 = vM1.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)), 0);
    const bookedDays = vM.reduce((s, r) => {
      const dur = Math.ceil((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000);
      return s + Math.min(dur, daysInM);
    }, 0);
    return {
      vehicule: `${v.make} ${v.model} (${v.licensePlate})`,
      ca_mois: Math.round(caM * 100) / 100,
      evolution_vs_m1: evolPct(caM, caM1),
      taux_occupation: daysInM > 0 ? Math.round(bookedDays / daysInM * 100) : 0,
    };
  });

  const mFixedCosts = monthlyVehicleCosts.filter(c => c.type === 'fixed').reduce((s, c) => s + c.amount, 0);
  const mVariableCosts = monthlyVehicleCosts.filter(c => c.type !== 'fixed').reduce((s, c) => s + c.amount, 0);
  const mTotalCosts = mFixedCosts + mVariableCosts;
  const mMarge = mStats.ca - mTotalCosts;

  return {
    settings,
    societe: settings?.senderName ?? 'Sun and Drive',
    mois_courant: { ...mStats, evolution_pct_m1: evolPct(mStats.ca, m1Stats.ca), evolution_pct_n1: evolPct(mStats.ca, n1Stats.ca) },
    m_moins_1: m1Stats,
    m_moins_2: m2Stats,
    n_moins_1: n1Stats,
    caParVehicule,
    nextMonthLabel: nextM.label,
    nbReservationsNextMonth: rentalsInPeriod(nextM.start, nextM.end).length,
    alertes_ct: ctAlerts.map(ct => ({
      vehicule: `${ct.vehicle.make} ${ct.vehicle.model} (${ct.vehicle.licensePlate})`,
      expiration: ct.expiryAt,
    })),
    siege_auto_alerts: carSeatAlerts.length,
    messages_en_attente: pendingMessages.length,
    finances_mois: {
      coutsMensuels: Math.round(mTotalCosts * 100) / 100,
      coutsFixesMensuels: Math.round(mFixedCosts * 100) / 100,
      coutsVariablesMensuels: Math.round(mVariableCosts * 100) / 100,
      margeMois: Math.round(mMarge * 100) / 100,
    },
  };
}

// ── Génération mensuelle asynchrone ──────────────────────────────────────────

export async function generateMonthlyReportAsync(
  tenantDbUrl: string,
  reportId: string,
  companyId: string,
  month: string,
): Promise<void> {
  console.log(`[CeoReport Monthly] ▶ Génération — companyId=${companyId} month=${month}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[CeoReport Monthly] ✗ ANTHROPIC_API_KEY non définie');
    return;
  }
  const db = getTenantClient(tenantDbUrl);
  try {
    const data = await collectMonthlyData(db, month);
    const { settings } = data;
    const now = new Date();

    const ctLines = data.alertes_ct.map(ct => `- ${ct.vehicule}: expire le ${new Date(ct.expiration).toLocaleDateString('fr-FR')}`).join('\n') || 'Aucun';

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: `Tu es un analyste stratégique expert en mobilité et location de véhicules.
Tu génères des bilans mensuels professionnels, concis et actionnables en français pour un CEO.
IMPORTANT : retourne UNIQUEMENT du JSON valide, sans markdown, sans backticks.`,
      messages: [{
        role: 'user',
        content: `Génère le bilan mensuel ${data.mois_courant.label} pour ${data.societe}.

PERFORMANCES DU MOIS :
- CA net : ${data.mois_courant.ca} € (M-1: ${data.m_moins_1.ca} €, N-1: ${data.n_moins_1.ca} €)
- Taux occupation : ${data.mois_courant.tauxOccupation}% (M-1: ${data.m_moins_1.tauxOccupation}%, N-1: ${data.n_moins_1.tauxOccupation}%)
- Locations : ${data.mois_courant.nbLocations} (M-1: ${data.m_moins_1.nbLocations}, N-1: ${data.n_moins_1.nbLocations})
- Km : ${data.mois_courant.km} (M-1: ${data.m_moins_1.km}, N-1: ${data.n_moins_1.km})

DONNÉES M-2 (${data.m_moins_2.label}) : CA=${data.m_moins_2.ca}€, taux=${data.m_moins_2.tauxOccupation}%, locations=${data.m_moins_2.nbLocations}

ANALYSE FINANCIÈRE DU MOIS :
- Coûts fixes mensuels : ${data.finances_mois.coutsFixesMensuels} €
- Coûts variables mensuels : ${data.finances_mois.coutsVariablesMensuels} €
- Total charges : ${data.finances_mois.coutsMensuels} €
- Marge nette estimée : ${data.finances_mois.margeMois} €

CA PAR VÉHICULE :
${data.caParVehicule.map(v => `- ${v.vehicule}: ${v.ca_mois}€ (évol. M-1: ${v.evolution_vs_m1}%), taux: ${v.taux_occupation}%`).join('\n')}

ALERTES OPÉRATIONNELLES :
- CT à renouveler (90j) : ${ctLines}
- Demandes siège auto en attente/rupture : ${data.siege_auto_alerts}
- Messages en attente d'approbation : ${data.messages_en_attente}

PRÉVISIONNEL MOIS SUIVANT (${data.nextMonthLabel}) :
- Réservations déjà confirmées : ${data.nbReservationsNextMonth}

Retourne exactement ce JSON (sans markdown) :
{
  "resume_mensuel": {
    "titre": "Bilan ${data.mois_courant.label}",
    "synthese": "3-4 phrases synthétisant les performances réelles avec les chiffres exacts",
    "points_forts": ["point fort 1 avec chiffre", "point fort 2", "point fort 3"],
    "points_attention": ["point d'attention 1 avec chiffre", "point d'attention 2"]
  },
  "analyse_vehicules": [
    ${data.caParVehicule.map(v => `{ "vehicule": "${v.vehicule}", "ca_mois": ${v.ca_mois}, "evolution_vs_m1": ${v.evolution_vs_m1}, "taux_occupation": ${v.taux_occupation}, "tendance": "hausse|stable|baisse", "commentaire": "1 phrase analyse" }`).join(',\n    ')}
  ],
  "alertes_operationnelles": [
    ${data.alertes_ct.length > 0 ? `{ "type": "ct", "priorite": "haute", "titre": "CT à renouveler", "detail": "${data.alertes_ct.map(c => c.vehicule).join(', ')}" }` : ''}
    ${data.siege_auto_alerts > 0 ? `${data.alertes_ct.length > 0 ? ',' : ''}{ "type": "siege_auto", "priorite": "moyenne", "titre": "${data.siege_auto_alerts} siège(s) auto en attente/rupture", "detail": "Traiter les demandes en attente" }` : ''}
    ${data.messages_en_attente > 0 ? `${(data.alertes_ct.length > 0 || data.siege_auto_alerts > 0) ? ',' : ''}{ "type": "message", "priorite": "moyenne", "titre": "${data.messages_en_attente} message(s) en attente de validation", "detail": "Valider ou rejeter les brouillons IA" }` : ''}
  ],
  "previsionnel_mois_suivant": {
    "ca_estime": <estimation numérique basée sur la tendance>,
    "nb_reservations_confirmees": ${data.nbReservationsNextMonth},
    "commentaire": "1-2 phrases analyse des perspectives"
  },
  "recommandations": [
    { "priorite": "haute|moyenne|basse", "titre": "titre court", "detail": "explication actionnable", "echeance": "délai concret" }
  ]
}`,
      }],
    });

    console.log(`[CeoReport Monthly] ✓ Claude — stop_reason=${response.stop_reason}`);
    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse Claude non parseable');
    const aiData = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const content = {
      status: 'ready',
      mode: 'monthly',
      generatedAt: now.toISOString(),
      theme: {
        primaryColor: settings?.primaryColor ?? '#01696e',
        fontFamily: settings?.fontFamily ?? 'Montserrat',
        logoUrl: settings?.logoUrl ?? null,
        companyName: settings?.senderName ?? 'Sun and Drive',
      },
      resume_mensuel: aiData.resume_mensuel,
      comparaison: {
        ca: {
          mois_courant: { label: data.mois_courant.label, valeur: data.mois_courant.ca, evolution_pct_m1: data.mois_courant.evolution_pct_m1, evolution_pct_n1: data.mois_courant.evolution_pct_n1 },
          m_moins_1: { label: data.m_moins_1.label, valeur: data.m_moins_1.ca },
          m_moins_2: { label: data.m_moins_2.label, valeur: data.m_moins_2.ca },
          n_moins_1: { label: data.n_moins_1.label, valeur: data.n_moins_1.ca },
        },
        taux_occupation: {
          mois_courant: { label: data.mois_courant.label, valeur: data.mois_courant.tauxOccupation, evolution_pct_m1: data.mois_courant.tauxOccupation - data.m_moins_1.tauxOccupation, evolution_pct_n1: data.mois_courant.tauxOccupation - data.n_moins_1.tauxOccupation },
          m_moins_1: { label: data.m_moins_1.label, valeur: data.m_moins_1.tauxOccupation },
          m_moins_2: { label: data.m_moins_2.label, valeur: data.m_moins_2.tauxOccupation },
          n_moins_1: { label: data.n_moins_1.label, valeur: data.n_moins_1.tauxOccupation },
        },
        locations: {
          mois_courant: { label: data.mois_courant.label, valeur: data.mois_courant.nbLocations, evolution_pct_m1: evolPct(data.mois_courant.nbLocations, data.m_moins_1.nbLocations), evolution_pct_n1: evolPct(data.mois_courant.nbLocations, data.n_moins_1.nbLocations) },
          m_moins_1: { label: data.m_moins_1.label, valeur: data.m_moins_1.nbLocations },
          m_moins_2: { label: data.m_moins_2.label, valeur: data.m_moins_2.nbLocations },
          n_moins_1: { label: data.n_moins_1.label, valeur: data.n_moins_1.nbLocations },
        },
        km: {
          mois_courant: { label: data.mois_courant.label, valeur: data.mois_courant.km, evolution_pct_m1: evolPct(data.mois_courant.km, data.m_moins_1.km), evolution_pct_n1: evolPct(data.mois_courant.km, data.n_moins_1.km) },
          m_moins_1: { label: data.m_moins_1.label, valeur: data.m_moins_1.km },
          m_moins_2: { label: data.m_moins_2.label, valeur: data.m_moins_2.km },
          n_moins_1: { label: data.n_moins_1.label, valeur: data.n_moins_1.km },
        },
      },
      analyse_vehicules: aiData.analyse_vehicules,
      alertes_operationnelles: aiData.alertes_operationnelles,
      previsionnel_mois_suivant: aiData.previsionnel_mois_suivant,
      recommandations: aiData.recommandations,
    };

    await db.ceoReport.update({
      where: { id: reportId },
      data: { status: 'ready', content: content as never, generatedAt: now },
    });
    console.log(`[CeoReport Monthly] ✓ Terminé — ${month} companyId=${companyId}`);
  } catch (err) {
    console.error(`[CeoReport Monthly] ✗ Erreur:`, err);
    try { await db.ceoReport.update({ where: { id: reportId }, data: { status: 'error' } }); } catch {}
  }
}

// ── GET /intelligence/report?month=YYYY-MM&mode=annual|monthly ────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const month = typeof req.query.month === 'string' && req.query.month
      ? req.query.month
      : new Date().toISOString().slice(0, 7);
    const mode = req.query.mode === 'monthly' ? 'monthly' : 'annual';
    const companyId = req.auth!.tenantSlug as string;
    const db = getTenantClient(req.tenantDbUrl!);

    const existing = await db.ceoReport.findFirst({ where: { companyId, month, mode } });

    if (existing?.status === 'ready' && existing.content) {
      return res.json(existing.content);
    }
    if (existing?.status === 'generating') return res.json({ status: 'generating' });
    if (existing?.status === 'error')     return res.json({ status: 'error' });
    return res.json({ status: 'absent' });
  } catch (err) { next(err); }
});

// ── POST /intelligence/report/generate ───────────────────────────────────────

router.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { month, mode: bodyMode } = req.body as { month?: string; mode?: string };
    const monthKey = typeof month === 'string' && month ? month : new Date().toISOString().slice(0, 7);
    const mode = bodyMode === 'monthly' ? 'monthly' : 'annual';
    const companyId = req.auth!.tenantSlug as string;
    const db = getTenantClient(req.tenantDbUrl!);

    const existing = await db.ceoReport.findFirst({ where: { companyId, month: monthKey, mode } });
    let report;
    if (existing) {
      report = await db.ceoReport.update({
        where: { id: existing.id },
        data: { status: 'generating', generatedAt: null },
      });
    } else {
      report = await db.ceoReport.create({
        data: { companyId, month: monthKey, mode, status: 'generating' },
      });
    }

    if (mode === 'monthly') {
      void generateMonthlyReportAsync(req.tenantDbUrl!, report.id, companyId, monthKey);
    } else {
      void generateCeoReportAsync(req.tenantDbUrl!, report.id, companyId, monthKey);
    }
    return res.json({ status: 'generating' });
  } catch (err) { next(err); }
});

export default router;
