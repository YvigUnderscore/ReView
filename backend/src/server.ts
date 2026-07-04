import http from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { initSocket } from './services/SocketService';
import { storage } from './services/StorageService';
import { purgeExpiredTrash } from './lib/trash';
import { getNumericSetting, SETTING_KEYS } from './lib/settings';

const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // quotidien

/** Balayage périodique de la corbeille : purge les éléments expirés (rétention configurable). */
function scheduleTrashSweep(): void {
  const sweep = async () => {
    try {
      const days = await getNumericSetting(SETTING_KEYS.TRASH_RETENTION_DAYS);
      const purged = await purgeExpiredTrash(days);
      if (purged > 0)
        console.info(`[Trash] purge automatique : ${purged} élément(s) supprimé(s) définitivement.`);
    } catch (err) {
      console.error('[Trash] échec du balayage de purge :', err);
    }
  };
  // Premier passage différé de 60 s pour ne pas alourdir le démarrage.
  setTimeout(sweep, 60_000);
  setInterval(sweep, TRASH_SWEEP_INTERVAL_MS).unref();
}

async function main(): Promise<void> {
  // S'assure que le bucket MinIO existe avant d'accepter du trafic.
  await storage.ensureBucket();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  scheduleTrashSweep();

  server.listen(env.PORT, () => {
    console.info(`✅ ReView 2.0 backend démarré sur le port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  console.error('❌ Échec du démarrage du serveur :', err);
  process.exit(1);
});
