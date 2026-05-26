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

// GET /api/v1/exports/vehicles
router.get('/vehicles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicles = await db.vehicle.findMany({
      where: { isActive: true },
      include: {
        technicalControls: { orderBy: { expiryAt: 'desc' }, take: 1 },
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
      v.technicalControls[0] ? formatDate(v.technicalControls[0].expiryAt) : '',
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
