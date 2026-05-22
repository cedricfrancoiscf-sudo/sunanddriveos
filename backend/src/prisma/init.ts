// Script d'initialisation au démarrage — exécuté avant le serveur
// Idempotent : peut être lancé plusieurs fois sans danger

import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import { getMasterClient, getTenantClient } from './client';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDb(maxRetries = 20, delayMs = 3000): Promise<void> {
  const master = getMasterClient();
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await master.$queryRaw`SELECT 1`;
      await master.$disconnect();
      console.log('[Init] Base de données prête');
      return;
    } catch {
      console.log(`[Init] Attente PostgreSQL... tentative ${i}/${maxRetries}`);
      await sleep(delayMs);
    }
  }
  throw new Error('[Init] Base de données inaccessible après plusieurs tentatives');
}

function pushSchema(schema: string, dbUrl: string, label: string): void {
  console.log(`[Init] Push schema ${label}...`);
  execSync(
    `./node_modules/.bin/prisma db push --schema=${schema} --skip-generate --accept-data-loss`,
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_MASTER_URL: process.env.DATABASE_MASTER_URL,
        DATABASE_TENANT_URL: dbUrl,
      },
    },
  );
  console.log(`[Init] Schema ${label} — OK`);
}

async function init(): Promise<void> {
  console.log('[Init] ============================================');
  console.log('[Init]  SunanddriveOS — Initialisation au démarrage');
  console.log('[Init] ============================================');

  // 1. Attendre PostgreSQL
  await waitForDb();

  // 2. Push schema master
  pushSchema('./src/prisma/master/schema.prisma', process.env.DATABASE_MASTER_URL!, 'master');

  const master = getMasterClient();

  // 3. Seed master — SuperAdmin
  const SUPER_ADMIN_EMAIL = 'admin@sunanddriveos.com';
  const existingAdmin = await master.superAdmin.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('ChangeMe2024!', 12);
    await master.superAdmin.create({
      data: { email: SUPER_ADMIN_EMAIL, passwordHash, name: 'Super Admin' },
    });
    console.log(`[Init] SuperAdmin créé : ${SUPER_ADMIN_EMAIL}`);
  } else {
    console.log(`[Init] SuperAdmin OK : ${SUPER_ADMIN_EMAIL}`);
  }

  // 4. Seed master — Société Sun and Drive
  const COMPANY_SLUG = 'sun-and-drive';
  let company = await master.company.findUnique({ where: { slug: COMPANY_SLUG } });
  if (!company) {
    const dbPassword = process.env.DB_PASSWORD ?? 'sunanddriveos';
    const tenantDbUrl = `postgresql://sunanddriveos:${dbPassword}@db-master:5432/sunanddriveos_tenant_sun_and_drive`;
    company = await master.company.create({
      data: {
        name: 'Sun and Drive',
        slug: COMPANY_SLUG,
        primaryColor: '#01696e',
        secondaryColor: '#04292a',
        plan: 'pro',
        tenantDbUrl,
        isActive: true,
      },
    });
    console.log('[Init] Société créée : Sun and Drive');
  } else {
    console.log('[Init] Société OK : Sun and Drive');
  }

  // 5. Push schema tenant pour chaque société active
  const companies = await master.company.findMany({
    where: { isActive: true },
    select: { slug: true, tenantDbUrl: true },
  });

  for (const c of companies) {
    pushSchema('./src/prisma/tenant/schema.prisma', c.tenantDbUrl, `tenant ${c.slug}`);
  }

  // 6. Seed tenant — utilisateur admin initial
  for (const c of companies) {
    const db = getTenantClient(c.tenantDbUrl);
    const existingUser = await db.user.findFirst({ where: { role: 'admin' } });
    if (!existingUser) {
      const passwordHash = await bcrypt.hash('Admin2024!', 12);
      await db.user.create({
        data: {
          email: 'admin@sunanddrive.fr',
          passwordHash,
          name: 'Administrateur',
          role: 'admin',
          isActive: true,
        },
      });
      console.log(`[Init] Utilisateur admin créé pour ${c.slug} : admin@sunanddrive.fr / Admin2024!`);
    } else {
      console.log(`[Init] Utilisateurs OK pour ${c.slug}`);
    }
    await db.$disconnect();
  }

  await master.$disconnect();

  console.log('[Init] ============================================');
  console.log('[Init]  Initialisation terminée — démarrage serveur');
  console.log('[Init] ============================================');
}

init().catch((err: unknown) => {
  console.error('[Init] Erreur fatale :', err);
  process.exit(1);
});
