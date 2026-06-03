// Diagnostic des charges Getaround — lecture seule, aucune modification en base
// Usage : npx tsx src/scripts/test-invoices.ts
// Charger le .env depuis la racine du projet (3 niveaux au-dessus de backend/src/scripts)
import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(__dirname, '../../../.env') });
// Fallback : racine monorepo
if (!process.env.DATABASE_MASTER_URL) {
  config({ path: path.resolve(process.cwd(), '.env') });
}
import axios from 'axios';
import { getMasterClient, getTenantClient } from '../prisma/client';
import { decrypt } from '../utils/crypto';

const BASE = 'https://api-eu.getaround.com/owner/v1';
const MAX_RENTALS = 20;

function ga(apiKey: string) {
  return axios.create({
    baseURL: BASE,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    timeout: 15_000,
  });
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface Charge { type: string; amount: number; }
interface Invoice { id: number; total_price: number; currency: string; charges?: Charge[]; product_type?: string; }
interface RentalId { id: number; }

async function main() {
  console.log('=== DIAGNOSTIC CHARGES GETAROUND ===\n');
  console.log('Usage : npx tsx src/scripts/test-invoices.ts [API_KEY]');
  console.log('  ou   : GETAROUND_API_KEY=xxx npx tsx src/scripts/test-invoices.ts\n');

  // 1. Clé API : argument CLI > variable env > base de données
  let apiKey: string | undefined = process.argv[2] ?? process.env.GETAROUND_API_KEY;

  if (!apiKey) {
    try {
      const master = getMasterClient();
      const company = await master.company.findFirst({
        where: { isActive: true },
        select: { tenantDbUrl: true, name: true, slug: true },
      });
      if (!company) { console.error('Aucune société active en base'); process.exit(1); }
      console.log(`Société : ${company.name} (${company.slug})`);

      const db = getTenantClient(company.tenantDbUrl);
      const account = await db.getaroundAccount.findFirst({
        where: { isActive: true },
        select: { id: true, name: true, apiKeyHash: true },
      });
      if (!account) { console.error('Aucun compte Getaround actif'); process.exit(1); }
      console.log(`Compte Getaround : ${account.name}\n`);
      apiKey = decrypt(account.apiKeyHash);
    } catch (dbErr) {
      console.error('❌ Base de données inaccessible :', (dbErr as Error).message);
      console.error('\nPassez la clé API directement :');
      console.error('  npx tsx src/scripts/test-invoices.ts <VOTRE_CLE_API>');
      console.error('  ou : GETAROUND_API_KEY=xxx npx tsx src/scripts/test-invoices.ts');
      process.exit(1);
    }
  } else {
    console.log(`Clé API fournie via ${process.argv[2] ? 'argument CLI' : 'variable GETAROUND_API_KEY'}\n`);
  }

  const client = ga(apiKey);

  // 2. Récupérer 20 locations récentes (terminées)
  const now = new Date();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000);
  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace('T', 'T');

  let rentalIds: RentalId[] = [];
  try {
    const res = await client.get<RentalId[]>(
      `/rentals.json?start_date=${fmt(sixtyDaysAgo)}&end_date=${fmt(now)}&per_page=${MAX_RENTALS}`
    );
    rentalIds = Array.isArray(res.data) ? res.data.slice(0, MAX_RENTALS) : [];
  } catch (e) {
    console.error('Erreur GET /rentals.json :', (e as Error).message);
    process.exit(1);
  }
  console.log(`${rentalIds.length} location(s) récupérée(s)\n`);

  // Accumulateurs pour le résumé
  const allTypes = new Map<string, { amounts: number[]; count: number }>();
  let exactMatches = 0;

  // 3 & 4. Pour chaque location, récupérer les invoices
  for (const { id: rentalId } of rentalIds) {
    await sleep(400);
    let invoices: Invoice[] = [];
    try {
      const res = await client.get<Invoice[]>(`/rentals/${rentalId}/invoices.json`);
      invoices = Array.isArray(res.data) ? res.data : [];
    } catch {
      console.log(`Rental ${rentalId} : erreur invoices — skip`);
      continue;
    }

    for (const inv of invoices) {
      const charges = inv.charges ?? [];
      if (charges.length === 0) continue;

      const totalPriceEur = inv.total_price / 100;
      let sumPos = 0, sumNeg = 0;

      console.log(`\n─── Rental ${rentalId} / Invoice ${inv.id} ─────────────────────`);
      console.log(`  product_type : ${inv.product_type ?? '?'}`);
      console.log(`  total_price  : ${totalPriceEur.toFixed(2)} €`);
      console.log('  Charges :');

      for (const c of charges) {
        const eur = c.amount / 100;
        console.log(`    ${String(c.type).padEnd(45)} ${eur >= 0 ? '+' : ''}${eur.toFixed(2)} €`);
        if (eur >= 0) sumPos += eur; else sumNeg += eur;

        // Accumuler pour résumé
        if (!allTypes.has(c.type)) allTypes.set(c.type, { amounts: [], count: 0 });
        const t = allTypes.get(c.type)!;
        t.amounts.push(eur);
        t.count++;
      }

      const computed = Math.round((sumPos + sumNeg) * 100) / 100;
      const tp = Math.round(totalPriceEur * 100) / 100;
      const match = computed === tp;
      const ecart = Math.round((tp - computed) * 100) / 100;
      if (match) exactMatches++;

      console.log(`  SUM positifs : +${sumPos.toFixed(2)} €`);
      console.log(`  SUM négatifs : ${sumNeg.toFixed(2)} €`);
      console.log(`  SUM total    : ${computed.toFixed(2)} €`);
      console.log(`  total_price  : ${tp.toFixed(2)} €`);
      console.log(`  Égalité ?    : ${match ? '✅ OUI' : `❌ NON (écart : ${ecart.toFixed(2)} €)`}`);
    }
  }

  // 5. Résumé final
  console.log('\n\n══════════════════════════════════════════════════════');
  console.log('RÉSUMÉ — TOUS LES TYPES DE CHARGES RENCONTRÉS');
  console.log('══════════════════════════════════════════════════════\n');

  const sorted = [...allTypes.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`${'TYPE'.padEnd(48)} ${'NB'.padStart(4)}  ${'MIN'.padStart(9)}  ${'MAX'.padStart(9)}  ${'MOY'.padStart(9)}`);
  console.log('─'.repeat(90));
  for (const [type, { amounts, count }] of sorted) {
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    console.log(
      `${type.padEnd(48)} ${String(count).padStart(4)}  ${min.toFixed(2).padStart(9)} €  ${max.toFixed(2).padStart(9)} €  ${avg.toFixed(2).padStart(9)} €`
    );
  }

  console.log(`\nLocations avec SUM = total_price exactement : ${exactMatches}`);
  console.log(`Types uniques rencontrés : ${allTypes.size}`);
}

main().catch(e => { console.error(e); process.exit(1); });
