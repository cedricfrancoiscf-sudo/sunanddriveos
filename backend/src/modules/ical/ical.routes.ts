import { Router, type Request, type Response, type NextFunction } from 'express';
import { getMasterClient, getTenantClient } from '../../prisma/client';
import { generateAccessoriesIcal } from './ical.service';

const router: Router = Router();

// GET /ical/:token/accessories.ics — route publique, pas de JWT
// Compatible Google Agenda, Apple Calendar, Outlook (abonnement calendrier)
router.get('/:token/accessories.ics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params['token'] as string;

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { icalToken: token },
      select: { tenantDbUrl: true, isActive: true },
    });

    if (!company || !company.isActive) {
      res.status(404).send('Calendrier introuvable ou société inactive');
      return;
    }

    const db = getTenantClient(company.tenantDbUrl);
    const icalContent = await generateAccessoriesIcal(db);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="accessories.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(icalContent);
  } catch (err) { next(err); }
});

export default router;
