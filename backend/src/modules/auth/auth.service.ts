import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { PrismaClient as TenantClient } from '../../generated/tenant';
import type { PrismaClient as MasterClient } from '../../generated/master';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

export interface LoginResult {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role?: string;
    isSuperAdmin?: boolean;
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

  const token = jwt.sign(
    { userId: user.id, tenantSlug, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as never },
  );

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
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

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
