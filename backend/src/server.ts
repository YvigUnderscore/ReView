import http from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { initSocket } from './services/SocketService';
import { storage } from './services/StorageService';
import { purgeExpiredTrash } from './lib/trash';
import { getNumericSetting, SETTING_KEYS } from './lib/settings';
import { sendDailyDigests } from './services/DigestService';
import { logger } from './lib/logger';

const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // quotidien

/** Balayage périodique de la corbeille : purge les éléments expirés (rétention configurable). */
function scheduleTrashSweep(): void {
  const sweep = async () => {
    try {
      const days = await getNumericSetting(SETTING_KEYS.TRASH_RETENTION_DAYS);
      const purged = await purgeExpiredTrash(days);
      if (purged > 0)
        logger.info(`[Trash] purge automatique : ${purged} élément(s) supprimé(s) définitivement.`);
    } catch (err) {
      logger.error({ err }, '[Trash] échec du balayage de purge');
    }
  };
  // Premier passage différé de 60 s pour ne pas alourdir le démarrage.
  setTimeout(sweep, 60_000);
  setInterval(sweep, TRASH_SWEEP_INTERVAL_MS).unref();
}

/** Digest email quotidien : premier envoi à DIGEST_HOUR (heure locale), puis toutes les 24 h. */
function scheduleDailyDigest(): void {
  const run = async () => {
    try {
      await sendDailyDigests();
    } catch (err) {
      logger.error({ err }, '[Digest] échec de l’envoi quotidien');
    }
  };
  const next = new Date();
  next.setHours(env.DIGEST_HOUR, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    void run();
    setInterval(run, 24 * 60 * 60 * 1000).unref();
  }, next.getTime() - Date.now()).unref();
  logger.info(`[Digest] prochain envoi planifié : ${next.toLocaleString('fr-FR')}`);
}

async function main(): Promise<void> {
  // S'assure que le bucket MinIO existe avant d'accepter du trafic.
  await storage.ensureBucket();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  scheduleTrashSweep();
  scheduleDailyDigest();

  server.listen(env.PORT, () => {
    logger.info(`✅ ReView 2.0 backend démarré sur le port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  logger.error({ err }, '❌ Échec du démarrage du serveur');
  process.exit(1);
});
