// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import http from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { initSocket } from './services/SocketService';
import { storage } from './services/StorageService';
import { prisma } from './lib/prisma';
import { closeQueues } from './services/JobService';
import { closeWorkerEvents } from './lib/workerEvents';
import { scheduleMaintenanceJobs } from './lib/maintenanceSchedule';
import { reconcileStuckMedia, RECONCILE_BOOT_DELAY_MS } from './lib/mediaReconcile';
import { installShutdownHandlers, registerShutdownTask, SHUTDOWN_PHASE } from './lib/gracefulShutdown';
import { logger } from './lib/logger';

/**
 * Process API.
 *
 * Les trois rendez-vous périodiques (digest, rapport hebdomadaire, purge) ne sont plus
 * des `setInterval` : ils sont posés en file répétable (`lib/maintenanceSchedule`) et
 * exécutés par le worker. L'API reste l'endroit qui les **planifie**, parce que c'est
 * elle qui porte `DIGEST_HOUR`.
 */

async function main(): Promise<void> {
  // S'assure que le bucket MinIO existe avant d'accepter du trafic.
  await storage.ensureBucket();

  const app = createApp();
  const server = http.createServer(app);
  const io = initSocket(server);

  // Entretien périodique : mêmes heures qu'avant, mais en file (survit au redémarrage,
  // ne part qu'une fois, visible dans le tableau de bord des files).
  await scheduleMaintenanceJobs(env.DIGEST_HOUR).catch((err: unknown) => {
    logger.error({ err }, '[maintenance] pose des travaux périodiques impossible');
  });

  // Réconciliation au démarrage : les médias figés en PROCESSING par un worker tué
  // n'ont plus de job vivant — sans ce balayage, ils le restent pour toujours. Différée
  // pour laisser le worker se connecter à la file et éviter tout faux positif.
  setTimeout(() => {
    void reconcileStuckMedia().catch((err: unknown) => {
      logger.error({ err }, '[reconcile] balayage des médias figés impossible');
    });
  }, RECONCILE_BOOT_DELAY_MS).unref();

  // La dérogation ShotGrid ouvre des adresses normalement refusées (HTTP, réseau
  // privé) : si elle est posée, on veut la voir à chaque démarrage, pas la découvrir
  // le jour d'un incident.
  if (env.SHOTGRID_INSECURE_HOSTS)
    logger.warn(
      { hosts: env.SHOTGRID_INSECURE_HOSTS },
      '⚠️  SHOTGRID_INSECURE_HOSTS actif : ces hôtes ShotGrid échappent au contrôle HTTPS/réseau privé. À réserver au simulateur de développement.',
    );

  // Arrêt propre : socket.io ferme le serveur HTTP qu'il enveloppe (clients prévenus),
  // puis les files et la base coupent leurs connexions. Sans cela, SIGTERM laissait les
  // connexions ouvertes jusqu'au SIGKILL de docker dix secondes plus tard.
  registerShutdownTask({
    name: 'http+socket.io',
    phase: SHUTDOWN_PHASE.STOP_INTAKE,
    run: async () => {
      // Les connexions keep-alive inactives retiendraient la fermeture ; celles qui
      // servent une requête sont laissées finir jusqu'au délai de grâce.
      server.closeIdleConnections();
      await io.close();
    },
    force: () => server.closeAllConnections(),
  });
  registerShutdownTask({
    name: 'queues',
    phase: SHUTDOWN_PHASE.STOP_INTAKE,
    run: () => closeQueues(),
  });
  registerShutdownTask({
    name: 'worker-events',
    phase: SHUTDOWN_PHASE.DISCONNECT,
    run: () => closeWorkerEvents(),
  });
  registerShutdownTask({
    name: 'prisma',
    phase: SHUTDOWN_PHASE.DISCONNECT,
    run: () => prisma.$disconnect(),
  });
  installShutdownHandlers();

  server.listen(env.PORT, () => {
    logger.info(`✅ ReView 2.0 backend démarré sur le port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  logger.error({ err }, '❌ Échec du démarrage du serveur');
  process.exit(1);
});
