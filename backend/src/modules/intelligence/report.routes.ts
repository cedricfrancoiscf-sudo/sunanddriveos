import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import Anthropic from '@anthropic-ai/sdk';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

router.get('/',
  (req: Request, res: Response, next: NextFunction) => {
    req.setTimeout(120_000);
    res.setTimeout(120_000);
    next();
  },
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
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

    const totalCA = rentals.reduce((s, r) => s + (r.ownerPayout ?? 0), 0);
    const totalGross = rentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);

    const monthlyCA: Record<string, number> = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyCA[d.toISOString().slice(0, 7)] = 0;
    }
    rentals.forEach(r => {
      const key = new Date(r.startAt).toISOString().slice(0, 7);
      if (key in monthlyCA) monthlyCA[key] += r.ownerPayout ?? 0;
    });

    const zoneStats: Record<string, { ca: number; count: number; carSeats: number }> = {};
    rentals.forEach(r => {
      const zone = r.vehicle?.deliveryPointName ?? r.vehicle?.parkingZone ?? 'Non définie';
      if (!zoneStats[zone]) zoneStats[zone] = { ca: 0, count: 0, carSeats: 0 };
      zoneStats[zone].ca += r.ownerPayout ?? 0;
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
      const vCA = vRentals.reduce((s, r) => s + (r.ownerPayout ?? 0), 0);
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

    const zones = [...new Set(vehicles.map(v => v.deliveryPointName ?? v.parkingZone).filter((z): z is string => Boolean(z)))];

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Rapport de fallback basé sur les données internes (utilisé en cas de timeout IA)
    function buildFallbackReport(): Record<string, unknown> {
      const topVehicle = vehicleStats.sort((a, b) => b.caNet - a.caNet)[0];
      return {
        resume_executif: `La flotte compte ${vehicles.length} véhicule(s) actif(s) avec un CA net de ${internalContext.caNet.toLocaleString('fr-FR')} € sur 12 mois (${internalContext.nbLocations} locations). Le taux d'occupation moyen est de ${internalContext.tauxOccupation}%. ${topVehicle ? `Meilleure performance : ${topVehicle.vehicule} avec ${topVehicle.caNet.toLocaleString('fr-FR')} € net.` : ''}`,
        swot: {
          forces: [`CA net 12 mois : ${internalContext.caNet.toLocaleString('fr-FR')} €`, `${internalContext.nbLocations} locations réalisées`, `Taux d'occupation : ${internalContext.tauxOccupation}%`],
          faiblesses: internalContext.nbIncidents > 0 ? [`${internalContext.nbIncidents} incident(s) sur la période`] : ['Données insuffisantes pour analyse complète'],
          opportunites: ['Optimisation des zones de livraison', 'Développement parc véhicules'],
          menaces: ['Concurrence autopartage', 'Évolution réglementation'],
        },
        pestel: { politique: 'Données veille externe non disponibles — relancez pour une analyse complète.', economique: '', sociologique: '', technologique: '', environnemental: '', legal: '' },
        veille_zones: zones.map(z => ({ zone: z, trafic_voyageurs: 'À compléter', perspectives: 'À analyser', opportunites: 'À évaluer', risques: 'À surveiller' })),
        veille_sectorielle: { autopartage: 'Données non disponibles', ademe: 'Données non disponibles', fiscalite: 'Données non disponibles', marche: 'Données non disponibles' },
        recommandations_ceo: [
          { priorite: 'haute', action: 'Analyser la rentabilité par véhicule', detail: `Focus sur les véhicules avec taux d'occupation < ${internalContext.tauxOccupation}%`, echeance: 'Court terme (1 mois)' },
          { priorite: 'moyenne', action: 'Optimiser les créneaux de disponibilité', detail: 'Identifier les périodes creuses et proposer des tarifs adaptés', echeance: 'Moyen terme (3 mois)' },
        ],
        analyse_accessoires: { demandes_par_zone: [], recommandations: ['Collecter plus de données sur les demandes de sièges auto'] },
        _fallback: true,
      };
    }

    const AI_TIMEOUT_MS = 90_000;
    const aiReportPromise = (async (): Promise<Record<string, unknown>> => {
      const response = await client.messages.create({
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
      // Extraction robuste du JSON
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return buildFallbackReport();
      try {
        return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      } catch {
        return { resume_executif: textContent.slice(0, 500), _parseError: true, ...buildFallbackReport() };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS)
    );

    let reportData: Record<string, unknown>;
    try {
      reportData = await Promise.race([aiReportPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof Error && err.message === 'AI_TIMEOUT') {
        reportData = buildFallbackReport();
      } else throw err;
    }

    res.json({
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
    });
  } catch (err: unknown) { next(err); }
});

export default router;
