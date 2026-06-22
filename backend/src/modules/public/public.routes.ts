import { Router, type Request, type Response, type NextFunction } from 'express';
import { getMasterClient, getTenantClient } from '../../prisma/client';

const router: Router = Router();

function normalizeLogoUrl(url: string | null | undefined, req: Request): string | null {
  if (!url) return null;
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) return url;
  const publicBase = process.env.BACKEND_URL
    ? process.env.BACKEND_URL.replace(/\/api\/v1\/?$/, '')
    : `${req.protocol}://${req.get('host')}`;
  return url.replace(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, publicBase);
}

// GET /public/vehicles/:licensePlate — accessible sans auth
router.get('/vehicles/:licensePlate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lp = (req.params.licensePlate as string).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const master = getMasterClient();
    const companies = await master.company.findMany({ where: { isActive: true }, select: { tenantDbUrl: true } });

    for (const company of companies) {
      const db = getTenantClient(company.tenantDbUrl);
      const vehicle = await db.vehicle.findFirst({
        where: { isActive: true, licensePlate: { contains: lp, mode: 'insensitive' } },
        select: {
          id: true, make: true, model: true, year: true, color: true, photoUrl: true,
          fuelType: true, deliveryPointName: true, deliveryPostalCode: true, parkingZone: true,
          getaroundId: true,
        },
      });
      if (vehicle) {
        const getaroundUrl = vehicle.getaroundId
          ? `https://fr.getaround.com/cars/${vehicle.getaroundId}`
          : null;
        res.json({
          make: vehicle.make, model: vehicle.model, year: vehicle.year,
          color: vehicle.color, photoUrl: vehicle.photoUrl,
          fuelType: vehicle.fuelType,
          deliveryZone: vehicle.deliveryPointName,
          deliveryPostalCode: vehicle.deliveryPostalCode,
          parkingZone: vehicle.parkingZone,
          getaroundUrl,
        });
        return;
      }
    }

    res.status(404).json({ error: 'Véhicule non trouvé' });
  } catch (err: unknown) { next(err); }
});

// GET /public/brand?slug=sun-and-drive — branding public pour la page de connexion
router.get('/brand', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : 'sun-and-drive';
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug },
      select: { tenantDbUrl: true, name: true, isActive: true },
    });
    if (!company || !company.isActive) {
      res.json({ logoUrl: null, companyName: null });
      return;
    }
    const db = getTenantClient(company.tenantDbUrl);
    const settings = await db.companySettings.findFirst({
      select: { logoUrl: true, primaryColor: true },
    });
    res.json({
      logoUrl: normalizeLogoUrl(settings?.logoUrl, req),
      companyName: company.name ?? null,
      primaryColor: settings?.primaryColor ?? '#01696e',
    });
  } catch (err: unknown) { next(err); }
});

export default router;
