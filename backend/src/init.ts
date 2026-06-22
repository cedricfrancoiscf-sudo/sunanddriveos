// Script d'initialisation au démarrage — exécuté avant le serveur
// Idempotent : peut être lancé plusieurs fois sans danger
// Resilient : n'arrête pas le processus sur erreur non-fatale

import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import { getMasterClient, getTenantClient } from './prisma/client';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDb(maxRetries = 20, delayMs = 3000): Promise<void> {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const master = getMasterClient();
      await master.$queryRaw`SELECT 1`;
      console.log('[Init] Base de données prête');
      return;
    } catch {
      if (i === maxRetries) {
        throw new Error(`[Init] PostgreSQL inaccessible après ${maxRetries} tentatives`);
      }
      console.log(`[Init] Attente PostgreSQL... tentative ${i}/${maxRetries}`);
      await sleep(delayMs);
    }
  }
}

function pushSchema(schema: string, dbUrl: string, label: string): void {
  try {
    console.log(`[Init] Push schema ${label}...`);
    execSync(
      `./node_modules/.bin/prisma db push --schema=${schema} --skip-generate --accept-data-loss`,
      {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_MASTER_URL: process.env.DATABASE_MASTER_URL, DATABASE_TENANT_URL: dbUrl },
      },
    );
    console.log(`[Init] Schema ${label} — OK`);
  } catch (err: unknown) {
    console.error(`[Init] WARN push ${label} :`, (err as Error).message?.split('\n')[0]);
  }
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

  // 3. Seed SuperAdmin
  try {
    const SA_EMAIL = 'admin@sunanddriveos.com';
    const existing = await master.superAdmin.findUnique({ where: { email: SA_EMAIL } });
    if (!existing) {
      const passwordHash = await bcrypt.hash('ChangeMe2024!', 12);
      await master.superAdmin.create({ data: { email: SA_EMAIL, passwordHash, name: 'Super Admin' } });
      console.log(`[Init] SuperAdmin créé : ${SA_EMAIL}`);
    } else {
      console.log(`[Init] SuperAdmin OK : ${SA_EMAIL}`);
    }
  } catch (err: unknown) {
    console.error('[Init] WARN SuperAdmin :', (err as Error).message);
  }

  // 4. Seed plans tarifaires (idempotent)
  try {
    const planNames = ['starter', 'pro', 'enterprise'] as const;
    for (const name of planNames) {
      await master.planConfig.upsert({
        where: { name },
        create: { name, priceMonthly: 0, priceYearly: 0, description: '', features: [], isActive: true },
        update: {},
      });
    }
    console.log('[Init] Plans tarifaires OK (starter / pro / enterprise)');
  } catch (err: unknown) {
    console.error('[Init] WARN plans :', (err as Error).message);
  }

  // 5. Seed société Sun and Drive
  let companies: Array<{ slug: string; tenantDbUrl: string }> = [];
  try {
    const SLUG = 'sun-and-drive';
    let company = await master.company.findUnique({ where: { slug: SLUG } });
    // Date d'expiration trial lointaine (10 ans) pour que le compte soit toujours actif
    const farFuture = new Date(Date.now() + 10 * 365 * 86_400_000);
    if (!company) {
      const dbPassword = process.env.DB_PASSWORD ?? 'sunanddriveos';
      company = await master.company.create({
        data: {
          name: 'Sun and Drive',
          slug: SLUG,
          primaryColor: '#01696e',
          secondaryColor: '#04292a',
          plan: 'enterprise',
          trialEndsAt: farFuture,
          tenantDbUrl: `postgresql://sunanddriveos:${dbPassword}@db-master:5432/sunanddriveos_tenant_sun_and_drive`,
          isActive: true,
        },
      });
      console.log('[Init] Société créée : Sun and Drive (enterprise, trial 10 ans)');
    } else {
      // Toujours forcer enterprise permanent, sans trial
      await master.company.update({
        where: { id: company.id },
        data: { plan: 'enterprise', trialEndsAt: null, isActive: true, subscriptionMode: 'forced', subscriptionStatus: 'active' },
      });
      console.log('[Init] Société mise à jour : Sun and Drive → enterprise permanent (trialEndsAt: null)');
    }
    companies = await master.company.findMany({ where: { isActive: true }, select: { slug: true, tenantDbUrl: true } });
  } catch (err: unknown) {
    console.error('[Init] WARN société :', (err as Error).message);
  }

  // 5. Push schema tenant + seed utilisateur admin
  for (const c of companies) {
    pushSchema('./src/prisma/tenant/schema.prisma', c.tenantDbUrl, `tenant ${c.slug}`);
    try {
      const db = getTenantClient(c.tenantDbUrl);
      const existingUser = await db.user.findFirst({ where: { role: 'admin' } });
      if (!existingUser) {
        const passwordHash = await bcrypt.hash('Admin2024!', 12);
        await db.user.create({
          data: { email: 'admin@sunanddrive.fr', passwordHash, name: 'Administrateur', role: 'admin', isActive: true },
        });
        console.log(`[Init] Admin créé pour ${c.slug} : admin@sunanddrive.fr / Admin2024!`);
      } else {
        console.log(`[Init] Utilisateurs OK pour ${c.slug}`);
      }
    } catch (err: unknown) {
      console.error(`[Init] WARN seed ${c.slug} :`, (err as Error).message);
    }
  }

  console.log('[Init] ============================================');
  console.log('[Init]  Initialisation terminée — démarrage serveur');
  console.log('[Init] ============================================');
}

init()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[Init] ERREUR FATALE (DB inaccessible) :', err);
    process.exit(1);
  });
