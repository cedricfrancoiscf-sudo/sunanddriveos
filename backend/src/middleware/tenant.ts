import type { Request, Response, NextFunction } from 'express';
import { getMasterClient } from '../prisma/client';

export async function resolveTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantSlug = req.auth?.tenantSlug;
  if (!tenantSlug) {
    res.status(400).json({ error: 'Tenant non identifié' });
    return;
  }

  try {
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: tenantSlug, isActive: true },
      select: { tenantDbUrl: true },
    });

    if (!company) {
      res.status(403).json({ error: 'Société inactive ou introuvable' });
      return;
    }

    req.tenantDbUrl = company.tenantDbUrl;
    next();
  } catch (err) {
    next(err);
  }
}
