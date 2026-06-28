import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { getMasterClient, getTenantClient } from '../../prisma/client';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { loginUser, loginSuperAdmin, hashPassword } from './auth.service';
import { sendEmail } from '../../utils/mailer';

const router: Router = Router();

// Réécrit les URLs locales (localhost, 127.x, 192.168.x, 10.x, IP NAS) vers PUBLIC_URL
const PRIVATE_HOST_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?/;

function normalizeLogoUrl(url: string | null | undefined, _req: Request): string | null {
  if (!url) return null;
  if (!PRIVATE_HOST_RE.test(url)) return url;
  const publicBase = (process.env.PUBLIC_URL ?? process.env.FRONTEND_URL ?? 'https://appli.sunanddrive.com').replace(/\/$/, '');
  return url.replace(PRIVATE_HOST_RE, publicBase);
}

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
  } catch (err: unknown) {
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
  } catch (err: unknown) {
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
      const master = getMasterClient();
      const [user, settings, company] = await Promise.all([
        tenantClient.user.findUnique({
          where: { id: req.auth!.userId! },
          select: { id: true, name: true, email: true, role: true, roles: true, lastLoginAt: true, createdAt: true },
        }),
        tenantClient.companySettings.findFirst({ select: { logoUrl: true } }),
        master.company.findFirst({
          where: { slug: req.auth!.tenantSlug! },
          select: { plan: true, subscriptionStatus: true, trialEndsAt: true },
        }),
      ]);

      if (!user) {
        res.status(404).json({ error: 'Utilisateur introuvable' });
        return;
      }

      const hasActiveSubscription =
        company?.subscriptionStatus === 'active' ||
        company?.subscriptionStatus === 'trialing';

      res.json({
        user: {
          ...user,
          logoUrl: normalizeLogoUrl(settings?.logoUrl, req),
          plan: company?.plan ?? 'starter',
          trialEndsAt: company?.trialEndsAt?.toISOString() ?? null,
          hasActiveSubscription,
        },
        tenantSlug: req.auth!.tenantSlug,
      });
    } catch (err: unknown) {
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
    } catch (err: unknown) {
      next(err);
    }
  },
);

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ email: z.string().email(), companySlug: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: body.data.companySlug, isActive: true },
      select: { tenantDbUrl: true },
    });

    // Toujours répondre la même chose pour éviter l'énumération
    const SAFE_RESPONSE = { message: 'Si cet email existe, un lien a été envoyé' };

    if (!company) { res.json(SAFE_RESPONSE); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const user = await db.user.findUnique({ where: { email: body.data.email.toLowerCase() }, select: { id: true, name: true } });
    if (!user) { res.json(SAFE_RESPONSE); return; }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 24 * 3_600_000);

    await db.user.update({ where: { id: user.id }, data: { resetToken: token, resetExpiry: expiry } });

    const resetUrl = `${process.env.FRONTEND_URL ?? ''}/reset-password?token=${token}&slug=${body.data.companySlug}`;
    void sendEmail({
      to: body.data.email,
      subject: 'Réinitialisation de votre mot de passe — SunanddriveOS',
      html: `
        <p>Bonjour ${user.name},</p>
        <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#01696e;color:#fff;text-decoration:none;border-radius:6px;">
            Réinitialiser mon mot de passe
          </a>
        </p>
        <p>Ce lien est valable 24 heures. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
      `,
    }).catch(e => console.error('[Auth] Erreur envoi email reset:', e));

    res.json(SAFE_RESPONSE);
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      token: z.string().min(1),
      companySlug: z.string().min(1),
      newPassword: z.string().min(8),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: body.data.companySlug, isActive: true },
      select: { tenantDbUrl: true },
    });
    if (!company) { res.status(400).json({ error: 'Lien invalide ou expiré' }); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const user = await db.user.findUnique({ where: { resetToken: body.data.token }, select: { id: true, resetExpiry: true } });

    if (!user || !user.resetExpiry || user.resetExpiry < new Date()) {
      res.status(400).json({ error: 'Lien invalide ou expiré' });
      return;
    }

    const passwordHash = await hashPassword(body.data.newPassword);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetExpiry: null },
    });

    res.json({ message: 'Mot de passe mis à jour' });
  } catch (err: unknown) { next(err); }
});

export default router;
