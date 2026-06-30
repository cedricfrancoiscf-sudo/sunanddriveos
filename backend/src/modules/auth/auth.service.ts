import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { PrismaClient as TenantClient } from '../../generated/tenant';
import type { PrismaClient as MasterClient } from '../../generated/master';
import { getMasterClient } from '../../prisma/client';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

export interface LoginResult {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role?: string;
    roles?: string[];
    isSuperAdmin?: boolean;
    plan?: string;
    trialEndsAt?: string | null;
    hasActiveSubscription?: boolean;
  };
}

export async function loginUser(
  tenantClient: TenantClient,
  tenantSlug: string,
  email: string,
  password: string,
): Promise<LoginResult> {
  const user = await tenantClient.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user || !user.passwordHash || !user.isActive) {
    throw Object.assign(new Error('Identifiants incorrects'), { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Identifiants incorrects'), { status: 401 });
  }

  await tenantClient.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Récupère plan + trial depuis la DB master
  const master = getMasterClient();
  const company = await master.company.findFirst({
    where: { slug: tenantSlug },
    select: { plan: true, trialEndsAt: true, stripeSubscriptionId: true },
  });

  const plan = company?.plan ?? 'starter';
  const trialEndsAt = company?.trialEndsAt?.toISOString() ?? null;
  const hasActiveSubscription = !!company?.stripeSubscriptionId;

  const token = jwt.sign(
    { userId: user.id, tenantSlug, role: user.role, roles: user.roles, plan, trialEndsAt, hasActiveSubscription },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as never },
  );

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, roles: user.roles, plan, trialEndsAt, hasActiveSubscription },
  };
}

export async function loginSuperAdmin(
  masterClient: MasterClient,
  email: string,
  password: string,
): Promise<LoginResult> {
  const admin = await masterClient.superAdmin.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!admin) {
    throw Object.assign(new Error('Identifiants incorrects'), { status: 401 });
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Identifiants incorrects'), { status: 401 });
  }

  const token = jwt.sign(
    { superAdminId: admin.id, isSuperAdmin: true },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as never },
  );

  return {
    token,
    user: { id: admin.id, name: admin.name, email: admin.email, isSuperAdmin: true },
  };
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
