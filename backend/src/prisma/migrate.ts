// Script de migration — base master + toutes les bases tenant actives
// Usage : npm run migrate

import { execSync } from 'child_process';
import { getMasterClient } from './client';

const master = getMasterClient();

function runMigration(schema: string, dbUrl: string, label: string): void {
  console.log(`[Migrate] Migration ${label}...`);
  execSync(`npx prisma migrate deploy --schema=${schema}`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_TENANT_URL: dbUrl },
  });
  console.log(`[Migrate] ${label} — OK`);
}

async function migrateAll(): Promise<void> {
  console.log('[Migrate] Démarrage migrations SunanddriveOS...');

  // Migration base master
  runMigration(
    'src/prisma/master/schema.prisma',
    process.env.DATABASE_MASTER_URL ?? '',
    'base master',
  );

  // Migration de toutes les bases tenant actives
  const companies = await master.company.findMany({
    where: { isActive: true },
    select: { slug: true, tenantDbUrl: true },
  });

  for (const company of companies) {
    runMigration(
      'src/prisma/tenant/schema.prisma',
      company.tenantDbUrl,
      `tenant ${company.slug}`,
    );
  }

  console.log(`[Migrate] ${companies.length} base(s) tenant migrée(s)`);
  console.log('[Migrate] Toutes les migrations terminées');
}

migrateAll()
  .catch((err: unknown) => {
    console.error('[Migrate] Erreur :', err);
    process.exit(1);
  })
  .finally(() => master.$disconnect());
