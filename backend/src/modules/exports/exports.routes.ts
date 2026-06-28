import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(','), ...rows.map(r => r.map(escapeCell).join(','))];
  return lines.join('\r\n');
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().split('T')[0];
}

function fecDate(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function fecAmount(v: number): string {
  return Math.abs(v).toFixed(2).replace('.', ',');
}

function buildFecLine(fields: (string | number)[]): string {
  return fields.map(f => (f === null || f === undefined) ? '' : String(f)).join('|');
}

// GET /api/v1/exports/fec?startDate=&endDate=
router.get('/fec', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.startDate ? new Date(req.query.startDate as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    to.setHours(23, 59, 59, 999);

    const db = getTenantClient(req.tenantDbUrl!);
    const [settings, rentals, costs] = await Promise.all([
      db.companySettings.findFirst(),
      db.rental.findMany({
        where: { endAt: { gte: from, lte: to }, status: { in: ['active', 'completed'] }, ownerPayout: { gt: 0 } },
        include: { vehicle: { select: { licensePlate: true, make: true, model: true } } },
        orderBy: { endAt: 'asc' },
      }),
      db.vehicleCost.findMany({
        where: {
          startDate: { lte: to },
          OR: [{ endDate: null }, { endDate: { gte: from } }],
        },
        include: { vehicle: { select: { licensePlate: true } } },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    const journalCode    = settings?.journalCode              ?? 'VT';
    const compteLocation = settings?.compteLocationsProduit   ?? '706100';
    const compteCharge   = settings?.compteEntretienCharge    ?? '615000';

    const FEC_HEADER = 'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLettr|DateLet|ValidDate|Montantdevise|Idevise';

    const lines: string[] = [FEC_HEADER];
    let seq = 1;

    for (const r of rentals) {
      const lib = `Location #${r.getaroundId} - ${r.driverName}`;
      const dateStr = fecDate(r.endAt);
      const pieceRef = r.getaroundId;
      lines.push(buildFecLine([
        journalCode, 'Ventes', String(seq).padStart(6, '0'), dateStr,
        compteLocation, 'Locations véhicules', '', '',
        pieceRef, dateStr, lib,
        '0,00', fecAmount(r.ownerPayout!),
        '', '', '', '', '',
      ]));
      seq++;
    }

    for (const c of costs) {
      const monthly = c.type === 'onetime' && c.amortizationMonths ? c.amount / c.amortizationMonths : c.amount;
      const lib = `${c.label} - ${c.vehicle.licensePlate}`;
      const dateStr = fecDate(c.startDate);
      lines.push(buildFecLine([
        journalCode, 'Achats', String(seq).padStart(6, '0'), dateStr,
        compteCharge, 'Charges véhicules', '', '',
        c.id.slice(0, 12), dateStr, lib,
        fecAmount(monthly), '0,00',
        '', '', '', '', '',
      ]));
      seq++;
    }

    const fileName = `sunanddriveos_fec_${from.toISOString().slice(0, 7)}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(lines.join('\r\n'));
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/exports/csv?startDate=&endDate=
router.get('/csv', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.startDate ? new Date(req.query.startDate as string) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    to.setHours(23, 59, 59, 999);

    const db = getTenantClient(req.tenantDbUrl!);
    const rentals = await db.rental.findMany({
      where: { startAt: { gte: from, lte: to } },
      include: { vehicle: { select: { make: true, model: true, licensePlate: true } } },
      orderBy: { startAt: 'asc' },
    });

    const STATUS_FR: Record<string, string> = {
      booked: 'Réservée', active: 'En cours', completed: 'Terminée', cancelled: 'Annulée',
    };

    const headers = ['Date', 'Locataire', 'Véhicule', 'Immatriculation', 'CA brut', 'CA net (ownerPayout)', 'Statut', 'GetaroundID'];
    const rows = rentals.map(r => [
      formatDate(r.startAt),
      r.driverName,
      `${r.vehicle.make} ${r.vehicle.model}`,
      r.vehicle.licensePlate,
      r.grossRevenue != null ? r.grossRevenue.toFixed(2).replace('.', ',') : '',
      r.ownerPayout  != null ? r.ownerPayout.toFixed(2).replace('.', ',')  : '',
      STATUS_FR[r.status] ?? r.status,
      r.getaroundId,
    ]);

    const csv = [headers, ...rows].map(r => r.join(';')).join('\r\n');
    const fileName = `sunanddriveos_locations_${from.toISOString().slice(0, 7)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send('﻿' + csv);
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/exports/rentals?from=&to=&status=
router.get('/rentals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    const status = req.query.status as string | undefined;

    const db = getTenantClient(req.tenantDbUrl!);
    const rentals = await db.rental.findMany({
      where: {
        startAt: { gte: from },
        endAt: { lte: to },
        ...(status ? { status: status as never } : {}),
      },
      include: { vehicle: { select: { make: true, model: true, licensePlate: true } } },
      orderBy: { startAt: 'asc' },
    });

    const headers = [
      'ID Getaround', 'Locataire', 'Email', 'Véhicule', 'Immatriculation',
      'Début', 'Fin', 'Km départ', 'Km retour', 'Km parcourus',
      'CA brut (€)', 'Virement (€)', 'Statut', 'Note',
    ];

    const rows = rentals.map(r => [
      r.getaroundId, r.driverName, r.driverEmail,
      `${r.vehicle.make} ${r.vehicle.model}`, r.vehicle.licensePlate,
      formatDate(r.startAt), formatDate(r.endAt),
      r.startMileage, r.endMileage, r.kmDriven,
      r.grossRevenue, r.ownerPayout,
      r.status, r.evaluationRating,
    ]);

    const csv = toCSV(headers, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="locations_${formatDate(from)}_${formatDate(to)}.csv"`);
    res.send('﻿' + csv); // BOM pour Excel FR
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/exports/accounting?from=&to=
router.get('/accounting', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();

    const db = getTenantClient(req.tenantDbUrl!);
    const rentals = await db.rental.findMany({
      where: {
        startAt: { gte: from, lte: to },
        status: { in: ['active', 'completed'] },
      },
      include: { vehicle: { select: { make: true, model: true, licensePlate: true } } },
      orderBy: { startAt: 'asc' },
    });

    const headers = [
      'Mois', 'ID Getaround', 'Locataire', 'Véhicule', 'Immatriculation',
      'Début', 'Fin', 'CA brut (€)', 'Commission Getaround (€)',
      'Virement propriétaire (€)', 'Frais mess. (€)', 'Compensation dommage (€)',
    ];

    const rows = rentals.map(r => {
      const commission = r.grossRevenue != null && r.ownerPayout != null
        ? Math.round((r.grossRevenue - r.ownerPayout) * 100) / 100
        : null;
      const month = r.startAt.toISOString().slice(0, 7);
      return [
        month, r.getaroundId, r.driverName,
        `${r.vehicle.make} ${r.vehicle.model}`, r.vehicle.licensePlate,
        formatDate(r.startAt), formatDate(r.endAt),
        r.grossRevenue, commission, r.ownerPayout,
        r.driverMessFee, r.damageCompensation,
      ];
    });

    const csv = toCSV(headers, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="comptabilite_${formatDate(from)}_${formatDate(to)}.csv"`);
    res.send('﻿' + csv);
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/exports/monthly-report — rapport mensuel JSON (CA, top/flop véhicules, alertes)
router.get('/monthly-report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [rentals, vehicles] = await Promise.all([
      db.rental.findMany({
        where: { startAt: { gte: from, lte: to }, status: { in: ['active', 'completed'] } },
        include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
      }),
      db.vehicle.findMany({ where: { isActive: true }, select: { id: true, make: true, model: true, licensePlate: true } }),
    ]);

    const totalRevenue = rentals.reduce((s: number, r) => s + (r.ownerPayout ?? 0), 0);
    const grossRevenue = rentals.reduce((s: number, r) => s + (r.grossRevenue ?? 0), 0);

    type VehicleRow = { vehicleId: string; name: string; plate: string; revenue: number; count: number };
    const byVehicle = new Map<string, VehicleRow>();
    for (const r of rentals) {
      const key = r.vehicleId;
      const e: VehicleRow = byVehicle.get(key) ?? { vehicleId: key, name: `${r.vehicle.make} ${r.vehicle.model}`, plate: r.vehicle.licensePlate, revenue: 0, count: 0 };
      e.revenue += r.ownerPayout ?? 0;
      e.count += 1;
      byVehicle.set(key, e);
    }

    const sorted = [...byVehicle.values()].sort((a, b) => b.revenue - a.revenue);

    res.json({
      month: from.toISOString().slice(0, 7),
      generatedAt: now.toISOString(),
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        grossRevenue: Math.round(grossRevenue * 100) / 100,
        rentalCount: rentals.length,
        vehicleCount: vehicles.length,
      },
      topVehicles: sorted.slice(0, 3),
      flopVehicles: sorted.slice(-3).reverse(),
    });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/exports/vehicles
router.get('/vehicles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicles = await db.vehicle.findMany({
      where: { isActive: true },
      include: {
        maintenanceTasks: { where: { type: 'ct' }, orderBy: { nextDueDate: 'desc' }, take: 1 },
        maintenances: { orderBy: { performedAt: 'desc' }, take: 1 },
      },
      orderBy: { make: 'asc' },
    });

    const headers = [
      'Marque', 'Modèle', 'Année', 'Immatriculation', 'Couleur',
      'Kilométrage actuel', 'Score santé', 'Expiration CT',
      'Dernier entretien',
    ];

    const rows = vehicles.map(v => [
      v.make, v.model, v.year, v.licensePlate, v.color,
      v.currentMileage, v.healthScore,
      v.maintenanceTasks[0]?.nextDueDate ? formatDate(v.maintenanceTasks[0].nextDueDate) : '',
      v.maintenances[0] ? formatDate(v.maintenances[0].performedAt) : '',
    ]);

    const csv = toCSV(headers, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="flotte.csv"');
    res.send('﻿' + csv);
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/exports/maintenance?from=&to=
router.get('/maintenance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();

    const db = getTenantClient(req.tenantDbUrl!);
    const maintenances = await db.maintenance.findMany({
      where: { performedAt: { gte: from, lte: to } },
      include: { vehicle: { select: { make: true, model: true, licensePlate: true } } },
      orderBy: { performedAt: 'desc' },
    });

    const headers = [
      'Véhicule', 'Immatriculation', 'Type', 'Date réalisation',
      'Km à l\'entretien', 'Coût (€)', 'Prestataire', 'Notes',
    ];

    const rows = maintenances.map(m => [
      `${m.vehicle.make} ${m.vehicle.model}`, m.vehicle.licensePlate,
      m.type, formatDate(m.performedAt),
      m.mileageAtService, m.cost, m.provider, m.notes,
    ]);

    const csv = toCSV(headers, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="entretiens_${formatDate(from)}_${formatDate(to)}.csv"`);
    res.send('﻿' + csv);
  } catch (err: unknown) { next(err); }
});

export default router;
