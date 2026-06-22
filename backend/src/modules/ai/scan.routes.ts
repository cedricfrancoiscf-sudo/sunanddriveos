import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// Accepte images ET PDFs (Claude Vision supporte nativement les deux)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max (PDFs plus lourds)
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Format non supporté — utilisez une image (JPG/PNG/WEBP) ou un PDF'));
    }
  },
});

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

async function extractFromFile(
  file: Express.Multer.File,
  prompt: string,
): Promise<Record<string, unknown>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const base64 = file.buffer.toString('base64');
  const isPdf = file.mimetype === 'application/pdf';

  if (isPdf) {
    console.log('[Scan] PDF reçu → envoi à Claude Vision (document natif)');
  }

  // Claude API supporte nativement application/pdf via le block type 'document'
  // (SDK v0.32 ne typifie pas encore DocumentBlockParam — cast nécessaire)
  const fileBlock = isPdf
    ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } } as unknown as Anthropic.ImageBlockParam)
    : ({ type: 'image', source: { type: 'base64', media_type: file.mimetype as ImageMediaType, data: base64 } } as Anthropic.ImageBlockParam);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        fileBlock,
        { type: 'text', text: isPdf ? `${prompt}\n\nNote : document PDF — analyse la première page.` : prompt },
      ],
    }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
  return JSON.parse(text.replace(/```json|```/g, '').trim()) as Record<string, unknown>;
}

// POST /api/v1/scan/vehicle
router.post('/vehicle', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image ou PDF requis' }); return; }
    const isPdf = req.file.mimetype === 'application/pdf';
    const data = await extractFromFile(req.file, `Analyse ce document (carte grise, certificat immatriculation, ou photo de véhicule).
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
    res.json({ success: true, data, isPdf });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/scan/technical-control
router.post('/technical-control', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image ou PDF requis' }); return; }
    const isPdf = req.file.mimetype === 'application/pdf';
    const data = await extractFromFile(req.file, `Analyse ce rapport de contrôle technique.
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
    res.json({ success: true, data, isPdf });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/scan/maintenance
router.post('/maintenance', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image ou PDF requis' }); return; }
    const isPdf = req.file.mimetype === 'application/pdf';
    const data = await extractFromFile(req.file, `Analyse cette facture d'entretien ou de réparation automobile.
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
    res.json({ success: true, data, isPdf });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/scan/invoice
router.post('/invoice', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Image ou PDF requis' }); return; }
    const isPdf = req.file.mimetype === 'application/pdf';
    const data = await extractFromFile(req.file, `Analyse cette facture ou document financier.
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
    res.json({ success: true, data, isPdf });
  } catch (err: unknown) { next(err); }
});

export default router;
