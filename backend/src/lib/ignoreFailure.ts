// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from './logger';

/**
 * Rejection handler for best-effort work: the failure must not fail the caller (cleanup of an orphaned
 * object, a lost progress update, a `lastUsedAt` touch), but it must not vanish either.
 *
 * It replaces `.catch(() => undefined)`, which kept the fire-and-forget semantics and dropped the only
 * trace of a storage or database incident. The handler still resolves to `undefined`; it only logs, with
 * the context of the call site.
 *
 * A Prisma P2025 (record already gone) is the expected outcome of an idempotent delete or update, not an
 * incident: it is logged at `debug` so a retried cleanup does not flood the warnings.
 *
 * `level: 'debug'` is for failures that are an expected outcome rather than an incident (a refused
 * follow-up the caller already accounts for).
 *
 * Usage: `await storage.deleteObject(key).catch(ignoreFailure('storage cleanup failed', { key }));`
 */
export function ignoreFailure(
  message: string,
  context: Record<string, unknown> = {},
  level: 'warn' | 'debug' = 'warn',
): (err: unknown) => undefined {
  return (err: unknown) => {
    const alreadyGone = (err as { code?: unknown } | null)?.code === 'P2025';
    logger[alreadyGone ? 'debug' : level]({ err, ...context }, message);
    return undefined;
  };
}
