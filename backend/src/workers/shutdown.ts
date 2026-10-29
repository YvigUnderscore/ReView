// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerShutdownTask, SHUTDOWN_PHASE } from '../lib/gracefulShutdown';
import { logger } from '../lib/logger';

/**
 * Shutdown of a BullMQ queue consumer.
 *
 * `worker.close()` waits for active jobs to finish: that is what we want, but a
 * transcode lasts minutes and Docker only leaves a few seconds before SIGKILL.
 * So we let the graceful close run until the grace period expires, then force it:
 * the job loses its lock, BullMQ will replay it, and the startup reconciliation catches
 * whatever would have stayed frozen.
 */

/** Minimal surface of a BullMQ `Worker`, to avoid generic variance issues. */
interface ClosableWorker {
  close(force?: boolean): Promise<void>;
}

export function registerWorkerShutdown(name: string, worker: ClosableWorker): void {
  registerShutdownTask({
    name,
    phase: SHUTDOWN_PHASE.STOP_INTAKE,
    run: () => worker.close(),
    force: () => {
      void worker.close(true).catch((err: unknown) => {
        logger.warn({ err }, `[shutdown] fermeture forcée impossible : ${name}`);
      });
    },
  });
}
