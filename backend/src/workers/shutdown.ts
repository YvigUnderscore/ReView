// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerShutdownTask, SHUTDOWN_PHASE } from '../lib/gracefulShutdown';
import { logger } from '../lib/logger';

/**
 * Extinction d'un consommateur de file BullMQ.
 *
 * `worker.close()` attend la fin des jobs actifs : c'est ce qu'on veut, mais un
 * transcodage dure des minutes et docker ne laisse que quelques secondes avant SIGKILL.
 * On laisse donc la fermeture douce courir jusqu'au délai de grâce, puis on force —
 * le job perd son verrou, BullMQ le rejouera, et la réconciliation au démarrage rattrape
 * ce qui serait resté figé.
 */

/** Surface minimale d'un `Worker` BullMQ, pour éviter la variance des génériques. */
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
