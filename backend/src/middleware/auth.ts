import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId?: string;
  superAdminId?: string;
  tenantSlug?: string;
  role?: string;
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
    if (!req.auth?.role || !roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'Rôle insuffisant' });
      return;
    }
    next();
  };
}
