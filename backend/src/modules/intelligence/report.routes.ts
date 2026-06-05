import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import Anthropic from '@anthropic-ai/sdk';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Collecte des données internes du tenant ──────────────────────────────────

async function collectTenantData(db: ReturnType<typeof getTenantClient>) {
  const now = new Date();
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);
  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);
  const nextMonth = new Date(Date.now() + 30 * 86_400_000);

  const [settings, vehicles, rentals, incidents, maintenances, technicalControls, carSeatRequests] = await Promise.all([
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
      where: { expiryAt: { lte: new Date(Date.now() + 90 * 86_400_000) } },
      select: { vehicleId: true, expiryAt: true, result: true,
                vehicle: { select: { make: true, model: true, licensePlate: true } } },
    }),
    db.carSeatRequest.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { vehicleId: true, status: true, createdAt: true,
                vehicle: { select: { parkingZone: true, deliveryPointName: true } } },
    }),
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

  const vehicleStats = vehicles.map(v => {
    const vRentals = rentals.filter(r => r.vehicleId === v.id);
    const vCA = vRentals.reduce((s, r) => s + ((r.ownerPayout ?? 0) > 0 ? r.ownerPayout! : Math.max(0, r.grossRevenue ?? 0)), 0);
    const vKm = vRentals.reduce((s, r) => s + (r.kmDriven ?? 0), 0);
    const vIncidents = incidents.filter(i => i.vehicleId === v.id).length;
    const vMaint = maintenances.filter(m => m.vehicleId === v.id);
    const vCT = technicalControls.filter(ct => ct.vehicleId === v.id);
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
    };
  });

  const zones = [...new Set(vehicles.map(v => v.deliveryPointName ?? v.parkingZone).filter((z): z is string => Boolean(z)))];

  const internalContext = {
    periode: '12 derniers mois',
    societe: settings?.senderName ?? 'Sun and Drive',
    flotte: vehicles.length,
    caNet: Math.round(totalCA * 100) / 100,
    caBrut: Math.round(totalGross * 100) / 100,
    tauxOccupation: occupancyRate,
    nbLocations: rentals.length,
    nbIncidents: incidents.length,
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

// ── Génération asynchrone (exportée pour le cron) ────────────────────────────

export async function generateCeoReportAsync(
  tenantDbUrl: string,
  reportId: string,
  companyId: string,
  month: string,
): Promise<void> {
  const db = getTenantClient(tenantDbUrl);
  try {
    const { settings, vehicleStats, zones, internalContext } = await collectTenantData(db);
    const now = new Date();

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

    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse Claude non parseable (pas de JSON détecté)');
    const reportData = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const content = {
      status: 'ready',
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

    await db.ceoReport.update({
      where: { id: reportId },
      data: { status: 'ready', content: content as never, generatedAt: now },
    });
    console.log(`[CeoReport] Génération terminée mois ${month} (${companyId})`);
  } catch (err) {
    console.error(`[CeoReport] Erreur génération ${month} (${companyId}):`, err instanceof Error ? err.message : err);
    try {
      await db.ceoReport.update({ where: { id: reportId }, data: { status: 'error' } });
    } catch { /* ignore secondary error */ }
  }
}

// ── GET /intelligence/report?month=YYYY-MM ───────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const month = typeof req.query.month === 'string' && req.query.month
      ? req.query.month
      : new Date().toISOString().slice(0, 7);
    const companyId = req.auth!.tenantSlug;
    const db = getTenantClient(req.tenantDbUrl!);

    const existing = await db.ceoReport.findFirst({ where: { companyId, month } });

    if (existing?.status === 'ready' && existing.content) {
      return res.json(existing.content);
    }
    if (existing?.status === 'generating') return res.json({ status: 'generating' });
    if (existing?.status === 'error')     return res.json({ status: 'error' });
    return res.json({ status: 'absent' });
  } catch (err) { next(err); }
});

// ── POST /intelligence/report/generate ──────────────────────────────────────

router.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { month } = req.body as { month?: string };
    const monthKey = typeof month === 'string' && month ? month : new Date().toISOString().slice(0, 7);
    const companyId = req.auth!.tenantSlug;
    const db = getTenantClient(req.tenantDbUrl!);

    const existing = await db.ceoReport.findFirst({ where: { companyId, month: monthKey } });
    let report;
    if (existing) {
      report = await db.ceoReport.update({
        where: { id: existing.id },
        data: { status: 'generating', generatedAt: null },
      });
    } else {
      report = await db.ceoReport.create({
        data: { companyId, month: monthKey, status: 'generating' },
      });
    }

    void generateCeoReportAsync(req.tenantDbUrl!, report.id, companyId, monthKey);
    return res.json({ status: 'generating' });
  } catch (err) { next(err); }
});

export default router;
