import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { getMasterClient, getTenantClient } from '../../prisma/client';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { loginUser, loginSuperAdmin } from './auth.service';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  companySlug: z.string().min(1),
});

const superAdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/v1/auth/login — connexion utilisateur tenant
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Données invalides', details: body.error.flatten() });
      return;
    }

    const { email, password, companySlug } = body.data;

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: companySlug, isActive: true },
      select: { tenantDbUrl: true },
    });

    if (!company) {
      res.status(401).json({ error: 'Identifiants incorrects' });
      return;
    }

    const tenantClient = getTenantClient(company.tenantDbUrl);
    const result = await loginUser(tenantClient, companySlug, email, password);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/superadmin/login — connexion super admin
router.post('/superadmin/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = superAdminLoginSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Données invalides', details: body.error.flatten() });
      return;
    }

    const { email, password } = body.data;
    const master = getMasterClient();
    const result = await loginSuperAdmin(master, email, password);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me — profil utilisateur courant
router.get(
  '/me',
  requireAuth,
  resolveTenant,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantClient = getTenantClient(req.tenantDbUrl!);
      const user = await tenantClient.user.findUnique({
        where: { id: req.auth!.userId! },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      if (!user) {
        res.status(404).json({ error: 'Utilisateur introuvable' });
        return;
      }

      res.json({ user, tenantSlug: req.auth!.tenantSlug });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/auth/superadmin/me — profil super admin courant
router.get(
  '/superadmin/me',
  requireAuth,
  requireSuperAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const master = getMasterClient();
      const admin = await master.superAdmin.findUnique({
        where: { id: req.auth!.superAdminId! },
        select: { id: true, name: true, email: true, createdAt: true },
      });

      if (!admin) {
        res.status(404).json({ error: 'Super admin introuvable' });
        return;
      }

      res.json({ user: { ...admin, isSuperAdmin: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
