// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import http from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { initSocket } from './services/SocketService';
import { storage } from './lib/storage';
import { prisma } from './lib/prisma';
import { closeQueues } from './lib/queues';
import { closeWorkerEvents } from './lib/workerEvents';
import { scheduleMaintenanceJobs } from './lib/maintenanceSchedule';
import { reconcileStuckMedia, RECONCILE_BOOT_DELAY_MS } from './lib/mediaReconcile';
import { installShutdownHandlers, registerShutdownTask, SHUTDOWN_PHASE } from './lib/gracefulShutdown';
import { logger } from './lib/logger';
import { isLoopbackEndpoint } from './lib/publicEndpoint';

/**
 * API process.
 *
 * The three periodic jobs (digest, weekly report, purge) are no longer `setInterval` calls: they are
 * queued as repeatable jobs (`lib/maintenanceSchedule`) and executed by the worker. The API remains
 * where they are **scheduled**, because it is the one holding `DIGEST_HOUR`.
 */

async function main(): Promise<void> {
  // Ensure the MinIO bucket exists before accepting traffic.
  await storage.ensureBucket();

  const app = createApp();
  const server = http.createServer(app);
  const io = initSocket(server);

  // Periodic maintenance: same hours as before, but queued (survives restarts, runs only once, visible
  // in the queue dashboard).
  await scheduleMaintenanceJobs(env.DIGEST_HOUR).catch((err: unknown) => {
    logger.error({ err }, '[maintenance] could not schedule the periodic jobs');
  });

  // Startup reconciliation: media left in PROCESSING by a killed worker no longer have a live job.
  // Deferred so the worker can connect to the queue first, avoiding false positives. The ongoing
  // catch-up no longer depends on this startup: `runPurge` (maintenance.worker) replays the sweep on
  // every maintenance pass. It is the worker that gets killed, not the API, and its restart never ran
  // this code.
  setTimeout(() => {
    void reconcileStuckMedia().catch((err: unknown) => {
      logger.error({ err }, '[reconcile] stuck media sweep failed');
    });
  }, RECONCILE_BOOT_DELAY_MS).unref();

  // The ShotGrid exception opens addresses normally refused (HTTP, private network): if it is set, we
  // want to see it on every startup, not discover it on the day of an incident.
  if (env.SHOTGRID_INSECURE_HOSTS)
    logger.warn(
      { hosts: env.SHOTGRID_INSECURE_HOSTS },
      '⚠️  SHOTGRID_INSECURE_HOSTS active: these ShotGrid hosts bypass the HTTPS/private network check. Reserve it for the development simulator.',
    );

  // Presigned URLs are built for the BROWSER, not for the server: left on a loopback address, each one
  // points at the visitor's own machine, and any upload goes nowhere as soon as ReView is opened from
  // another machine. The failure is silent and only shows on the first file, hence this startup
  // warning. `install.sh` sets the right value; a stack assembled by hand does not.
  if (isLoopbackEndpoint(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT))
    logger.warn(
      { S3_PUBLIC_ENDPOINT: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT },
      '⚠️  S3_PUBLIC_ENDPOINT points to a loopback address: media uploads will only work from this machine. For network access, set it to the host address (and expose MinIO with MINIO_BIND=0.0.0.0), as scripts/install.sh does.',
    );

  // Clean shutdown: socket.io closes the HTTP server it wraps (clients notified), then the queues and
  // the database close their connections. Without this, SIGTERM left connections open until docker's
  // SIGKILL ten seconds later.
  registerShutdownTask({
    name: 'http+socket.io',
    phase: SHUTDOWN_PHASE.STOP_INTAKE,
    run: async () => {
      // Idle keep-alive connections would hold up the close; those serving a request are left to finish
      // within the grace period.
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
    logger.info(`✅ ReView 2.0 backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  logger.error({ err }, '❌ Server startup failed');
  process.exit(1);
});
