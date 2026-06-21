import { Router, type Request, type Response, type NextFunction } from 'express';
import { getMasterClient, getTenantClient } from '../../prisma/client';

const router: Router = Router();

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

export default router;
