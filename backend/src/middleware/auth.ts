import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '../generated/tenant';
import { getTenantClient, getMasterClient } from '../prisma/client';

export interface AuthPayload {
  userId?: string;
  superAdminId?: string;
  tenantSlug?: string;
  role?: string;
  roles?: string[];
  isSuperAdmin?: boolean;
  plan?: string;
  trialEndsAt?: string | null;
  hasActiveSubscription?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      tenantDbUrl?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token manquant' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.isSuperAdmin) {
    res.status(403).json({ error: 'Accès réservé aux super admins' });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const primaryRole = req.auth?.role ?? '';
    const multiRoles = (req.auth?.roles as string[] | undefined) ?? [];
    const hasRole = roles.includes(primaryRole) || multiRoles.some(r => roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: 'Rôle insuffisant' });
      return;
    }
    next();
  };
}

// Vérifie que le user du JWT existe toujours en base (après resolveTenant)
export async function requireActiveUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth?.userId || !req.tenantDbUrl) { next(); return; }
  try {
    const db = getTenantClient(req.tenantDbUrl);
    const user = await db.user.findUnique({ where: { id: req.auth.userId }, select: { id: true, isActive: true } });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Session invalide' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Session invalide' });
  }
}

export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.auth?.isSuperAdmin) { next(); return; }

  // requireActiveSubscription est monté avant requireAuth sur /api/v1 —
  // on parse le JWT manuellement si req.auth n'est pas encore défini.
  let tenantSlug = req.auth?.tenantSlug;
  if (!tenantSlug) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) { next(); return; } // pas de token → laisser requireAuth gérer
    try {
      const token = header.slice(7);
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
      if (payload.isSuperAdmin) { next(); return; }
      tenantSlug = payload.tenantSlug;
      req.auth = payload; // populate req.auth pour les middlewares suivants
    } catch {
      next(); return; // token invalide → laisser requireAuth gérer
    }
  }

  if (!tenantSlug) { next(); return; }

  try {
    const master = getMasterClient();
    const company = await master.company.findFirst({
      where: { slug: tenantSlug },
      select: { plan: true, trialEndsAt: true, stripeSubscriptionId: true, isActive: true },
    });

    if (!company || !company.isActive) {
      res.status(403).json({ error: 'Compte inactif' }); return;
    }
    if (tenantSlug === 'sun-and-drive') { next(); return; }
    if (company.trialEndsAt && company.trialEndsAt > new Date()) { next(); return; }
    if (company.stripeSubscriptionId) { next(); return; }

    res.status(402).json({
      error: 'Abonnement requis',
      trialExpired: true,
      upgradeUrl: `${process.env.FRONTEND_URL ?? ''}/upgrade`,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

const PLAN_HIERARCHY: Record<string, number> = { starter: 0, pro: 1, enterprise: 2 };

export function requirePlan(minPlan: 'starter' | 'pro' | 'enterprise') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.auth?.isSuperAdmin) { next(); return; }
    if (req.auth?.tenantSlug === 'sun-and-drive') { next(); return; }
    try {
      const master = getMasterClient();
      const company = await master.company.findFirst({
        where: { slug: req.auth?.tenantSlug },
        select: { plan: true },
      });
      const current = PLAN_HIERARCHY[company?.plan ?? 'starter'] ?? 0;
      const required = PLAN_HIERARCHY[minPlan] ?? 0;
      if (current < required) {
        res.status(403).json({
          error: `Cette fonctionnalité nécessite le plan ${minPlan}`,
          requiredPlan: minPlan,
          currentPlan: company?.plan ?? 'starter',
        });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

export async function getCarekeeperVehicleIds(db: PrismaClient, userId: string): Promise<string[]> {
  const assignments = await db.vehicleCarkeeper.findMany({
    where: { userId },
    select: { vehicleId: true },
  });
  return assignments.map((a) => a.vehicleId);
}

// Retourne true UNIQUEMENT si l'utilisateur a carkeeper sans aucun rôle élevé.
// Admin + carkeeper → false (admin prime). Carkeeper seul → true.
export function isOnlyCarkeeper(auth: AuthPayload | undefined): boolean {
  const allRoles = [
    ...(auth?.role ? [auth.role] : []),
    ...((auth?.roles as string[] | undefined) ?? []),
  ];
  const elevated = ['admin', 'exploitation', 'exploitant', 'comptable'];
  const hasElevated = allRoles.some(r => elevated.includes(r));
  return allRoles.includes('carkeeper') && !hasElevated;
}
