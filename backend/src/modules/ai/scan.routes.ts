import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptées'));
  },
});

async function extractFromImage(
  file: Express.Multer.File,
  prompt: string,
): Promise<Record<string, unknown>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const base64 = file.buffer.toString('base64');
  const mediaType = file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
  return JSON.parse(text.replace(/```json|```/g, '').trim()) as Record<string, unknown>;
}

// POST /api/v1/scan/vehicle
router.post('/vehicle', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image requise' }); return; }
    const data = await extractFromImage(req.file, `Analyse ce document (carte grise, certificat immatriculation, ou photo de véhicule).
Extrait les informations du véhicule et retourne UNIQUEMENT ce JSON sans markdown :
{
  "licensePlate": "immatriculation en majuscules sans tiret ex: AB123CD",
  "make": "marque ex: Renault",
  "model": "modèle ex: Clio",
  "year": 2020,
  "color": "couleur en français",
  "fuelType": "essence|diesel|electrique|hybride|gpl",
  "confidence": 0.95
}
Si une information n'est pas visible, mets null pour ce champ.`);
    res.json({ success: true, data });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/scan/technical-control
router.post('/technical-control', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image requise' }); return; }
    const data = await extractFromImage(req.file, `Analyse ce rapport de contrôle technique.
Retourne UNIQUEMENT ce JSON sans markdown :
{
  "licensePlate": "immatriculation si visible",
  "performedAt": "date du CT au format YYYY-MM-DD",
  "expiryAt": "date d'expiration au format YYYY-MM-DD",
  "result": "favorable|defavorable|favorable_avec_prescription",
  "center": "nom du centre de CT si visible",
  "mileage": 45000,
  "observations": ["observation 1", "observation 2"],
  "confidence": 0.95
}
Si une information n'est pas visible, mets null.`);
    res.json({ success: true, data });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/scan/maintenance
router.post('/maintenance', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image requise' }); return; }
    const data = await extractFromImage(req.file, `Analyse cette facture d'entretien ou de réparation automobile.
Retourne UNIQUEMENT ce JSON sans markdown :
{
  "licensePlate": "immatriculation si visible",
  "type": "vidange|revision|freins|pneus|batterie|courroie|autre",
  "description": "description courte de l'intervention",
  "cost": 250.00,
  "performedAt": "date au format YYYY-MM-DD",
  "mileage": 45000,
  "garage": "nom du garage si visible",
  "nextServiceDate": "date prochaine révision si mentionnée YYYY-MM-DD",
  "nextServiceMileage": 50000,
  "confidence": 0.95
}
Si une information n'est pas visible, mets null.`);
    res.json({ success: true, data });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/scan/invoice
router.post('/invoice', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image requise' }); return; }
    const data = await extractFromImage(req.file, `Analyse cette facture ou document financier.
Retourne UNIQUEMENT ce JSON sans markdown :
{
  "type": "assurance|parking|credit|entretien|autre",
  "label": "libellé court ex: Assurance MAIF",
  "amount": 150.00,
  "period": "mensuel|annuel|ponctuel",
  "amountMonthly": 12.50,
  "issuer": "nom de l'émetteur",
  "licensePlates": ["AB123CD", "EF456GH"],
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "confidence": 0.95
}
Si une information n'est pas visible, mets null.`);
    res.json({ success: true, data });
  } catch (err: unknown) { next(err); }
});

export default router;
