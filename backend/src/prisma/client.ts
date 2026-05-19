// Fabrique de clients Prisma — architecture multi-tenant
// Master : une instance globale
// Tenant : une instance par société, mise en cache par URL

import { PrismaClient as MasterPrismaClient } from '../generated/master';
import { PrismaClient as TenantPrismaClient } from '../generated/tenant';

// Client master — singleton global
const masterClient = new MasterPrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

// Cache des clients tenant — évite de recréer des connexions inutiles
const tenantClients = new Map<string, TenantPrismaClient>();

export function getMasterClient(): MasterPrismaClient {
  return masterClient;
}

export function getTenantClient(tenantDbUrl: string): TenantPrismaClient {
  const cached = tenantClients.get(tenantDbUrl);
  if (cached !== undefined) return cached;

  const client = new TenantPrismaClient({
    datasources: { db: { url: tenantDbUrl } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  tenantClients.set(tenantDbUrl, client);
  return client;
}

// Fermeture gracieuse de toutes les connexions (SIGTERM)
export async function disconnectAll(): Promise<void> {
  const disconnectPromises: Array<Promise<void>> = [masterClient.$disconnect()];
  for (const client of tenantClients.values()) {
    disconnectPromises.push(client.$disconnect());
  }
  await Promise.all(disconnectPromises);
  tenantClients.clear();
}
