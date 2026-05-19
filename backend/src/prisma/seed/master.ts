// Seed initial — base master
// Crée : SuperAdmin + société Sun and Drive + base tenant initiale

import bcrypt from 'bcryptjs';
import { getMasterClient } from '../client';

const master = getMasterClient();

// Paramètres du seed — à changer avant déploiement
const SUPER_ADMIN_EMAIL = 'admin@sunanddriveos.com';
const SUPER_ADMIN_PASSWORD = 'ChangeMe2024!';
const SUPER_ADMIN_NAME = 'Super Admin';

const COMPANY_NAME = 'Sun and Drive';
const COMPANY_SLUG = 'sun-and-drive';

async function seedMaster(): Promise<void> {
  console.log('[Seed] Démarrage seed base master...');

  // Super Admin
  const existingAdmin = await master.superAdmin.findUnique({
    where: { email: SUPER_ADMIN_EMAIL },
  });

  if (existingAdmin === null) {
    const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
    await master.superAdmin.create({
      data: {
        email: SUPER_ADMIN_EMAIL,
        passwordHash,
        name: SUPER_ADMIN_NAME,
      },
    });
    console.log(`[Seed] SuperAdmin créé : ${SUPER_ADMIN_EMAIL}`);
  } else {
    console.log(`[Seed] SuperAdmin existe déjà : ${SUPER_ADMIN_EMAIL}`);
  }

  // Société Sun and Drive
  const existingCompany = await master.company.findUnique({
    where: { slug: COMPANY_SLUG },
  });

  if (existingCompany === null) {
    const dbPassword = process.env.DB_PASSWORD ?? 'sunanddriveos';
    const tenantDbName = `sunanddriveos_tenant_${COMPANY_SLUG.replace(/-/g, '_')}`;
    const tenantDbUrl = `postgresql://sunanddriveos:${dbPassword}@db-master:5432/${tenantDbName}`;

    await master.company.create({
      data: {
        name: COMPANY_NAME,
        slug: COMPANY_SLUG,
        primaryColor: '#01696e',
        secondaryColor: '#04292a',
        plan: 'pro',
        tenantDbUrl,
        isActive: true,
      },
    });
    console.log(`[Seed] Société créée : ${COMPANY_NAME}`);
    console.log(`[Seed] Base tenant : ${tenantDbName}`);
    console.log('[Seed] ACTION : créer la base tenant et lancer les migrations');
  } else {
    console.log(`[Seed] Société existe déjà : ${COMPANY_NAME}`);
  }

  console.log('[Seed] Seed master terminé');
}

seedMaster()
  .catch((err: unknown) => {
    console.error('[Seed] Erreur :', err);
    process.exit(1);
  })
  .finally(() => master.$disconnect());
