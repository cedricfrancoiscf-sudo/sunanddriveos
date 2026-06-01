import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '../generated/tenant';
import { getTenantClient } from '../prisma/client';

export interface AuthPayload {
  userId?: string;
  superAdminId?: string;
  tenantSlug?: string;
  role?: string;
  roles?: string[];
  isSuperAdmin?: boolean;
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

export async function getCarekeeperVehicleIds(db: PrismaClient, userId: string): Promise<string[]> {
  const assignments = await db.vehicleCarkeeper.findMany({
    where: { userId },
    select: { vehicleId: true },
  });
  return assignments.map((a) => a.vehicleId);
}
