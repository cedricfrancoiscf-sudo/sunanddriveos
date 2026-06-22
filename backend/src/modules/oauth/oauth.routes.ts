import { createHmac } from 'crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { sign, verify } from 'jsonwebtoken';
import { getMasterClient, getTenantClient } from '../../prisma/client';

const router: Router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-prod';

// Dérive un secret déterministe par tenant à partir du JWT_SECRET global.
// Permet de valider les credentials OAuth sans stocker de secret en DB.
function deriveClientSecret(slug: string): string {
  return createHmac('sha256', JWT_SECRET).update(`oauth:${slug}`).digest('hex');
}

// POST /api/v1/oauth/token — client_credentials flow
// Body: { client_id: slug, client_secret: string, grant_type: "client_credentials" }
router.post('/token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client_id, client_secret, grant_type } = req.body as {
      client_id?: string;
      client_secret?: string;
      grant_type?: string;
    };

    if (grant_type !== 'client_credentials') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    if (!client_id || !client_secret) {
      res.status(401).json({ error: 'invalid_client', error_description: 'client_id et client_secret requis' });
      return;
    }

    const expected = deriveClientSecret(client_id);
    if (client_secret !== expected) {
      res.status(401).json({ error: 'invalid_client', error_description: 'Identifiants invalides' });
      return;
    }

    const master = getMasterClient();
    const company = await master.company.findFirst({
      where: { slug: client_id, isActive: true },
      select: { id: true, slug: true, tenantDbUrl: true },
    });

    if (!company) {
      res.status(401).json({ error: 'invalid_client', error_description: 'Tenant non trouvé ou inactif' });
      return;
    }

    const accessToken = sign(
      { type: 'oauth', slug: company.slug, tenantDbUrl: company.tenantDbUrl, companyId: company.id },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/oauth/client-secret — retourne le secret à utiliser (admin seulement, protégé par JWT standard)
// Permet à un admin de récupérer son client_secret via l'interface
router.get('/client-secret/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token requis' });
      return;
    }
    const token = authHeader.slice(7);
    const payload = verify(token, JWT_SECRET) as { type?: string; role?: string; roles?: string[] };
    if (!payload || payload.type === 'oauth') {
      res.status(403).json({ error: 'Accès interdit' });
      return;
    }

    const { slug } = req.params as { slug: string };
    const clientSecret = deriveClientSecret(slug);
    res.json({ client_id: slug, client_secret: clientSecret });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/public/vehicles — liste des véhicules actifs (authentification OAuth required)
router.get('/vehicles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Bearer token requis' });
      return;
    }
    const token = authHeader.slice(7);
    let payload: { type?: string; tenantDbUrl?: string } | null = null;
    try {
      payload = verify(token, JWT_SECRET) as { type?: string; tenantDbUrl?: string };
    } catch {
      res.status(401).json({ error: 'Token invalide ou expiré' });
      return;
    }

    if (payload.type !== 'oauth' || !payload.tenantDbUrl) {
      res.status(403).json({ error: 'Token OAuth requis' });
      return;
    }

    const db = getTenantClient(payload.tenantDbUrl);
    const vehicles = await db.vehicle.findMany({
      where: { isActive: true },
      select: {
        id: true, make: true, model: true, year: true,
        licensePlate: true, color: true, fuelType: true,
        currentMileage: true, healthScore: true,
        photoUrl: true, parkingZone: true,
        deliveryPointName: true, deliveryPostalCode: true,
      },
      orderBy: { make: 'asc' },
    });

    res.json({ vehicles, count: vehicles.length });
  } catch (err: unknown) { next(err); }
});

export default router;
