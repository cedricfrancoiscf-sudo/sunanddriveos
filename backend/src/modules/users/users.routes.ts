import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient, getMasterClient } from '../../prisma/client';
import { hashPassword } from '../auth/auth.service';
import { sendInvitationEmail } from '../../utils/mailer';

const router: Router = Router();

const ROLES = ['admin', 'exploitation', 'comptable', 'carkeeper', 'third_party_owner'] as const;

// POST /api/v1/users/accept-invitation — public, résout le tenant via companySlug
router.post('/accept-invitation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      token: z.string().min(1),
      password: z.string().min(8),
      companySlug: z.string().min(1),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: body.data.companySlug, isActive: true },
      select: { tenantDbUrl: true },
    });
    if (!company) { res.status(404).json({ error: 'Société introuvable' }); return; }

    const db = getTenantClient(company.tenantDbUrl);
    const user = await db.user.findUnique({ where: { invitationToken: body.data.token } });

    if (!user || !user.invitationExpiry || user.invitationExpiry < new Date()) {
      res.status(400).json({ error: 'Invitation invalide ou expirée' });
      return;
    }

    const passwordHash = await hashPassword(body.data.password);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash, invitationToken: null, invitationExpiry: null, isActive: true },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// Routes admin uniquement
router.use(requireAuth, resolveTenant, requireRole('admin'));

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const users = await db.user.findMany({
      select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ users });
  } catch (err) { next(err); }
});

// POST /api/v1/users/invite — envoie une invitation
router.post('/invite', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(ROLES),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.user.findUnique({ where: { email: body.data.email } });
    if (existing) { res.status(409).json({ error: 'Email déjà utilisé' }); return; }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 7 * 86_400_000);

    const user = await db.user.create({
      data: {
        email: body.data.email.toLowerCase(),
        name: body.data.name,
        role: body.data.role,
        invitationToken: token,
        invitationExpiry: expiry,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    const inviteUrl = `${process.env.FRONTEND_URL}/accept-invitation?token=${token}&slug=${req.auth!.tenantSlug}`;
    console.log(`[Invite] ${body.data.email} → ${inviteUrl}`);

    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: req.auth!.tenantSlug },
      select: { name: true },
    });
    void sendInvitationEmail(body.data.email, body.data.name, inviteUrl, company?.name ?? 'SunanddriveOS').catch(console.error);

    res.status(201).json({ user, inviteUrl });
  } catch (err) { next(err); }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().optional(),
      role: z.enum(ROLES).optional(),
      isActive: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const user = await db.user.update({
      where: { id: (req.params.id as string) },
      data: body.data,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    res.json({ user });
  } catch (err) { next(err); }
});

export default router;
