// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

/**
 * Journal of a synchronization run.
 *
 * A synchronization touches hundreds of entities: without a trace, a partial import is undebuggable. Messages are recorded as an i18n key plus variables,
 * never as a ready-made sentence: the journal is read back in the reader's language, months after the run.
 */

export type SyncKind =
  'full' | 'incremental' | 'reconcile' | 'webhook' | 'polling' | 'import-versions' | 'diff' | 'push';

export interface SyncCounters {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

const zero = (): SyncCounters => ({ created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 });

export class SyncJournal {
  private readonly counters = new Map<string, SyncCounters>();
  private logCount = 0;
  private hasError = false;

  private constructor(
    readonly runId: number,
    readonly connectionId: number,
  ) {}

  static async start(
    connectionId: number,
    kind: SyncKind,
    triggeredById?: number | null,
  ): Promise<SyncJournal> {
    const run = await prisma.shotgridSyncRun.create({
      data: { connectionId, kind, status: 'running', triggeredById: triggeredById ?? null },
    });
    return new SyncJournal(run.id, connectionId);
  }

  counter(domain: string): SyncCounters {
    let c = this.counters.get(domain);
    if (!c) {
      c = zero();
      this.counters.set(domain, c);
    }
    return c;
  }

  count(domain: string, key: keyof SyncCounters, by = 1): void {
    this.counter(domain)[key] += by;
  }

  /**
   * Adds a line to the journal. The cap prevents a repeatedly failing synchronization from writing tens of thousands of lines: beyond it, only the counters
   * keep advancing, and a final message says so.
   */
  async log(
    level: 'info' | 'warn' | 'error' | 'conflict',
    messageKey: string,
    vars: Record<string, unknown> = {},
    ref: { sgType?: string; sgId?: number; localType?: string; localId?: number } = {},
  ): Promise<void> {
    if (level === 'error') this.hasError = true;
    if (this.logCount >= 2000) {
      if (this.logCount === 2000) {
        this.logCount += 1;
        await prisma.shotgridSyncLog.create({
          data: { runId: this.runId, level: 'warn', messageKey: 'shotgrid.log.truncated', vars: {} },
        });
      }
      return;
    }
    this.logCount += 1;
    await prisma.shotgridSyncLog.create({
      data: {
        runId: this.runId,
        level,
        messageKey,
        vars: vars as Prisma.InputJsonValue,
        sgType: ref.sgType ?? null,
        sgId: ref.sgId ?? null,
        localType: ref.localType ?? null,
        localId: ref.localId ?? null,
      },
    });
  }

  /**
   * Conflict detected: both sides have changed since the last synchronization.
   * Under the manual policy, the row stays unresolved and awaits human arbitration.
   */
  async conflict(
    messageKey: string,
    vars: Record<string, unknown>,
    ref: { sgType?: string; sgId?: number; localType?: string; localId?: number },
  ): Promise<void> {
    await this.log('conflict', messageKey, vars, ref);
  }

  async finish(status: 'ok' | 'partial' | 'error' | 'cancelled' = 'ok'): Promise<void> {
    const stats = Object.fromEntries(this.counters);
    const finalStatus = status === 'ok' && this.hasError ? 'partial' : status;
    await prisma.shotgridSyncRun.update({
      where: { id: this.runId },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        stats: stats as unknown as Prisma.InputJsonValue,
      },
    });
    logger.info({ runId: this.runId, status: finalStatus, stats }, 'Synchronisation ShotGrid terminée');
  }

  async fail(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.log('error', 'shotgrid.log.runFailed', { error: message });
    await prisma.shotgridSyncRun.update({
      where: { id: this.runId },
      data: {
        status: 'error',
        finishedAt: new Date(),
        stats: Object.fromEntries(this.counters) as unknown as Prisma.InputJsonValue,
      },
    });
    logger.error({ runId: this.runId, err: message }, 'Synchronisation ShotGrid en échec');
  }

  get totals(): SyncCounters {
    const total = zero();
    for (const c of this.counters.values()) {
      total.created += c.created;
      total.updated += c.updated;
      total.unchanged += c.unchanged;
      total.skipped += c.skipped;
      total.failed += c.failed;
    }
    return total;
  }
}

/** Recent runs of a connection, for the ShotGrid tab. */
export async function listRuns(connectionId: number, limit = 20) {
  return prisma.shotgridSyncRun.findMany({
    where: { connectionId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: {
      triggeredBy: { select: { id: true, name: true, email: true } },
      _count: { select: { logs: true } },
    },
  });
}

export async function listLogs(
  runId: number,
  options: { level?: string; skip?: number; take?: number } = {},
) {
  const where = { runId, ...(options.level ? { level: options.level } : {}) };
  const [items, total] = await Promise.all([
    prisma.shotgridSyncLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: options.skip ?? 0,
      take: options.take ?? 200,
    }),
    prisma.shotgridSyncLog.count({ where }),
  ]);
  return { items, total };
}

/** Unarbitrated conflicts, all runs combined — banner and comparison page. */
export async function listOpenConflicts(connectionId: number) {
  return prisma.shotgridSyncLog.findMany({
    where: { level: 'conflict', resolvedAt: null, run: { connectionId } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}
