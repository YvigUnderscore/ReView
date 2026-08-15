// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import http from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { initSocket } from './services/SocketService';
import { storage } from './services/StorageService';
import { purgeExpiredTrash } from './lib/trash';
import { purgeObsoleteDerived } from './lib/derivedPurge';
import { purgeIdempotencyRecords } from './lib/idempotency';
import { purge as purgeApiEvents } from './services/ApiEventService';
import { getNumericSetting, SETTING_KEYS } from './lib/settings';
import { sendDailyDigests } from './services/DigestService';
import { sendWeeklyReports } from './services/WeeklyReportService';
import { logger } from './lib/logger';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // quotidien

/** Balayage périodique de la corbeille : purge les éléments expirés (rétention configurable). */
function scheduleTrashSweep(): void {
  const sweep = async () => {
    try {
      const days = await getNumericSetting(SETTING_KEYS.TRASH_RETENTION_DAYS);
      const purged = await purgeExpiredTrash(days);
      if (purged > 0)
        logger.info(`[Trash] purge automatique : ${purged} élément(s) supprimé(s) définitivement.`);
      // Purge des dérivés obsolètes (37.H) — no-op si désactivée dans l'admin.
      await purgeObsoleteDerived();
      // API v1 : le journal d'événements et les clés d'idempotence sont des tampons, pas
      // des archives. Sans purge, ils grossissent indéfiniment au rythme du studio.
      const events = await purgeApiEvents();
      const keys = await purgeIdempotencyRecords();
      if (events > 0 || keys > 0)
        logger.info(`[API v1] purge : ${events} événement(s), ${keys} clé(s) d'idempotence.`);
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

/** Rapport hebdomadaire (43.B) : lundi à DIGEST_HOUR (heure locale), puis toutes les semaines. */
function scheduleWeeklyReport(): void {
  const run = async () => {
    try {
      await sendWeeklyReports();
    } catch (err) {
      logger.error({ err }, '[WeeklyReport] échec de l’envoi hebdomadaire');
    }
  };
  const next = new Date();
  next.setHours(env.DIGEST_HOUR, 0, 0, 0);
  // Avance jusqu'au prochain lundi (getDay : 0 = dimanche, 1 = lundi).
  do {
    next.setDate(next.getDate() + 1);
  } while (next.getDay() !== 1);
  setTimeout(() => {
    void run();
    setInterval(run, WEEK_MS).unref();
  }, next.getTime() - Date.now()).unref();
  logger.info(`[WeeklyReport] prochain envoi planifié : ${next.toLocaleString('fr-FR')}`);
}

async function main(): Promise<void> {
  // S'assure que le bucket MinIO existe avant d'accepter du trafic.
  await storage.ensureBucket();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  scheduleTrashSweep();
  scheduleDailyDigest();
  scheduleWeeklyReport();

  // La dérogation ShotGrid ouvre des adresses normalement refusées (HTTP, réseau
  // privé) : si elle est posée, on veut la voir à chaque démarrage, pas la découvrir
  // le jour d'un incident.
  if (env.SHOTGRID_INSECURE_HOSTS)
    logger.warn(
      { hosts: env.SHOTGRID_INSECURE_HOSTS },
      '⚠️  SHOTGRID_INSECURE_HOSTS actif : ces hôtes ShotGrid échappent au contrôle HTTPS/réseau privé. À réserver au simulateur de développement.',
    );

  server.listen(env.PORT, () => {
    logger.info(`✅ ReView 2.0 backend démarré sur le port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  logger.error({ err }, '❌ Échec du démarrage du serveur');
  process.exit(1);
});
