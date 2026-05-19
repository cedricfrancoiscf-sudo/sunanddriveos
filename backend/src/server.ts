// Point d'entrée du serveur Node.js
import 'dotenv/config';
import { createApp } from './app';
import { disconnectAll, getMasterClient, getTenantClient } from './prisma/client';
import { executePendingSequences } from './modules/sequences/sequences.service';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`[SunanddriveOS] Backend démarré — port ${PORT}`);
  console.log(`[SunanddriveOS] Environnement : ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[SunanddriveOS] Health : http://localhost:${PORT}/api/v1/health`);
});

// Planificateur de séquences — s'exécute toutes les minutes pour tous les tenants actifs
async function runSequenceScheduler(): Promise<void> {
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    for (const company of companies) {
      const db = getTenantClient(company.tenantDbUrl);
      const result = await executePendingSequences(db);
      if (result.executed > 0) {
        console.log(`[Séquences] ${company.slug} : ${result.executed}/${result.total} message(s) créé(s)`);
      }
    }
  } catch (err) {
    console.error('[Séquences] Erreur planificateur :', err);
  }
}

// Démarre après 10s pour laisser le temps à la DB de s'initialiser
setTimeout(() => {
  void runSequenceScheduler();
  setInterval(() => void runSequenceScheduler(), 60_000);
}, 10_000);

// Fermeture gracieuse — libère connexions Prisma proprement
const shutdown = async (signal: string): Promise<void> => {
  console.log(`[SunanddriveOS] Signal ${signal} reçu — arrêt en cours...`);
  server.close(async () => {
    await disconnectAll();
    console.log('[SunanddriveOS] Arrêt propre');
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
