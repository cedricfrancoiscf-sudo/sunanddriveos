// Script d'initialisation au démarrage — exécuté avant le serveur
// Idempotent : peut être lancé plusieurs fois sans danger
// Resilient : n'arrête pas le processus sur erreur non-fatale

import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import { getMasterClient, getTenantClient } from './client';

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

function pushSchema(schema: string, dbUrl: string, label: string): boolean {
  try {
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
    return true;
  } catch (err) {
    console.error(`[Init] WARN : push schema ${label} échoué (tables peut-être déjà à jour) :`, (err as Error).message?.split('\n')[0]);
    return false;
  }
}

async function init(): Promise<void> {
  console.log('[Init] ============================================');
  console.log('[Init]  SunanddriveOS — Initialisation au démarrage');
  console.log('[Init] ============================================');

  // 1. Attendre PostgreSQL (bloquant — sans DB le reste ne sert à rien)
  await waitForDb();

  // 2. Push schema master
  pushSchema('./src/prisma/master/schema.prisma', process.env.DATABASE_MASTER_URL!, 'master');

  const master = getMasterClient();

  // 3. Seed master — SuperAdmin
  try {
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
  } catch (err) {
    console.error('[Init] WARN : seed SuperAdmin échoué :', (err as Error).message);
  }

  // 4. Seed master — Société Sun and Drive
  let companies: Array<{ slug: string; tenantDbUrl: string }> = [];
  try {
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

    companies = await master.company.findMany({
      where: { isActive: true },
      select: { slug: true, tenantDbUrl: true },
    });
  } catch (err) {
    console.error('[Init] WARN : seed société échoué :', (err as Error).message);
  }

  // 5. Push schema tenant + seed utilisateurs
  for (const c of companies) {
    pushSchema('./src/prisma/tenant/schema.prisma', c.tenantDbUrl, `tenant ${c.slug}`);

    try {
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
    } catch (err) {
      console.error(`[Init] WARN : seed utilisateurs ${c.slug} échoué :`, (err as Error).message);
    }
  }

  console.log('[Init] ============================================');
  console.log('[Init]  Initialisation terminée — démarrage serveur');
  console.log('[Init] ============================================');
}

init()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    // Seule waitForDb peut lever une erreur fatale ici (DB inaccessible)
    console.error('[Init] ERREUR FATALE — DB inaccessible, impossible de démarrer :', err);
    process.exit(1);
  });
