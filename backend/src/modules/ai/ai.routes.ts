import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import { analyzeMessage, suggestReply, suggestCarSeatReply, forecastCashflow, detectMileageAnomalies, getPricingSuggestions } from './ai.service';
import { createOutboundMessage } from '../messages/messages.service';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// POST /api/v1/ai/analyze — analyse un message entrant
router.post('/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      content: z.string().min(1),
      messageId: z.string().optional(),
      rentalId: z.string().optional(),
      vehicleId: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const analysis = await analyzeMessage(body.data.content);
    const db = getTenantClient(req.tenantDbUrl!);

    // Persiste l'analyse si un messageId est fourni
    if (body.data.messageId) {
      await db.message.update({
        where: { id: body.data.messageId },
        data: { aiAnalysis: analysis as never },
      });
    }

    // Crée automatiquement une demande de siège auto si détectée
    let carSeatRequestId: string | undefined;
    if ((analysis as { isCarSeatRequest?: boolean }).isCarSeatRequest && body.data.vehicleId && body.data.rentalId) {
      const existing = await db.carSeatRequest.findFirst({
        where: { vehicleId: body.data.vehicleId, rentalId: body.data.rentalId, status: 'pending' },
      });
      if (!existing) {
        const csr = await db.carSeatRequest.create({
          data: { vehicleId: body.data.vehicleId, rentalId: body.data.rentalId, status: 'pending' },
        });
        carSeatRequestId = csr.id;
      }
    }

    res.json({ analysis, ...(carSeatRequestId ? { carSeatRequestId } : {}) });
  } catch (err) { next(err); }
});

// POST /api/v1/ai/suggest — génère une suggestion de réponse
router.post('/suggest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      rentalId: z.string().min(1),
      incomingContent: z.string().min(1),
      saveAsDraft: z.boolean().optional().default(false),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);

    // Récupère le contexte de la location
    const rental = await db.rental.findUnique({
      where: { id: body.data.rentalId },
      include: {
        vehicle: { select: { make: true, model: true, licensePlate: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { direction: true, content: true },
          take: 10,
        },
      },
    });

    if (!rental) { res.status(404).json({ error: 'Location introuvable' }); return; }

    // Récupère les paramètres IA de la société
    const settings = await db.companySettings.findFirst();
    const tone = (settings?.aiTone as 'vouvoiement' | 'tutoiement') ?? 'vouvoiement';

    const context = {
      driverName: rental.driverName,
      vehicleMake: rental.vehicle.make,
      vehicleModel: rental.vehicle.model,
      licensePlate: rental.vehicle.licensePlate,
      startDate: new Date(rental.startAt).toLocaleDateString('fr-FR'),
      endDate: new Date(rental.endAt).toLocaleDateString('fr-FR'),
    };

    const suggestion = await suggestReply(
      body.data.incomingContent,
      context,
      tone,
      rental.messages,
    );

    // Sauvegarde en brouillon si demandé
    if (body.data.saveAsDraft) {
      const message = await createOutboundMessage(
        db,
        body.data.rentalId,
        suggestion,
        suggestion,
      );
      res.json({ suggestion, messageId: message.id });
      return;
    }

    res.json({ suggestion });
  } catch (err) { next(err); }
});

// POST /api/v1/ai/suggest-car-seat — réponse IA pour demande siège auto avec vérification stock
router.post('/suggest-car-seat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      rentalId: z.string().min(1),
      childWeightKg: z.number().positive().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);

    const rental = await db.rental.findUnique({
      where: { id: body.data.rentalId },
      include: { vehicle: { select: { make: true, model: true, licensePlate: true } } },
    });
    if (!rental) { res.status(404).json({ error: 'Location introuvable' }); return; }

    const [settings, seats] = await Promise.all([
      db.companySettings.findFirst(),
      db.carSeat.findMany({ where: { isActive: true }, orderBy: { minWeightKg: 'asc' } }),
    ]);
    const tone = (settings?.aiTone as 'vouvoiement' | 'tutoiement') ?? 'vouvoiement';

    const context = {
      driverName: rental.driverName,
      vehicleMake: rental.vehicle.make,
      vehicleModel: rental.vehicle.model,
      licensePlate: rental.vehicle.licensePlate,
      startDate: new Date(rental.startAt).toLocaleDateString('fr-FR'),
      endDate: new Date(rental.endAt).toLocaleDateString('fr-FR'),
    };

    const reply = await suggestCarSeatReply(context, body.data.childWeightKg ?? null, seats, tone);

    // Trouver le siège adapté et disponible si poids fourni
    let matchedSeat: { id: string; name: string } | null = null;
    if (body.data.childWeightKg) {
      const w = body.data.childWeightKg;
      const found = seats.find(s => w >= s.minWeightKg && w <= s.maxWeightKg && s.availableStock > 0);
      if (found) matchedSeat = { id: found.id, name: found.name };
    }

    res.json({
      reply,
      matchedSeat,
      requiresWeight: body.data.childWeightKg === undefined,
    });
  } catch (err) { next(err); }
});

// GET /api/v1/ai/cashflow-forecast — prévision trésorerie 30 jours
router.get('/cashflow-forecast', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const forecast = await forecastCashflow(db);
    res.json({ forecast });
  } catch (err) { next(err); }
});

// GET /api/v1/ai/mileage-anomalies — détection anomalies kilométriques
router.get('/mileage-anomalies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const anomalies = await detectMileageAnomalies(db);
    res.json({ anomalies });
  } catch (err) { next(err); }
});

// GET /api/v1/ai/pricing-suggestions — suggestions tarifaires IA
router.get('/pricing-suggestions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const suggestions = await getPricingSuggestions(db);
    res.json({ suggestions });
  } catch (err) { next(err); }
});

export default router;
