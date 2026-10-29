// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';
import { logger } from './logger';
import { ignoreFailure } from './ignoreFailure';

/**
 * Idempotence of v1 writes (`Idempotency-Key` header).
 *
 * A pipeline script that loses its connection during a POST does not know whether the server processed the request. Without a safety net, the
 * reflex (replay) creates a second version. With an idempotency key, the replay retrieves the original response, identically.
 *
 * The key is **reserved before** execution, not recorded afterwards: between the processing and the write of the result, there is a window during
 * which a fast replay — or a second worker on the render farm — would slip through and create the duplicate one is precisely trying to avoid.
 * During this window, the reservation answers `409`.
 *
 * The fingerprint includes the route AND the token: two clients who would choose the same key — or the same client on two endpoints — cannot
 * return each other's response.
 */

/** Retention period of a memorised response. Beyond it, a replay is processed normally. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** `statusCode = 0` marks a request being processed (reservation). */
const IN_PROGRESS = 0;

export const fingerprint = (key: string, method: string, path: string, tokenId?: number): string =>
  createHash('sha256')
    .update(`${tokenId ?? 'session'} ${method} ${path} ${key}`)
    .digest('hex');

/** Normalised, bounded header: a key is an identifier, not a data channel. */
function readKey(req: Request): string | null {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) return null;
  const trimmed = key.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

const isExpired = (createdAt: Date): boolean => Date.now() - createdAt.getTime() >= IDEMPOTENCY_TTL_MS;

/**
 * Idempotency middleware. Without the header it does nothing: idempotency is a contract the client explicitly requests.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = readKey(req);
  if (!key) {
    next();
    return;
  }
  const fp = fingerprint(key, req.method, req.baseUrl + req.path, req.apiToken?.id);

  try {
    await prisma.idempotencyRecord.create({
      data: { fingerprint: fp, statusCode: IN_PROGRESS, response: {} },
    });
  } catch {
    // The key is already taken: either the response is known, or it is in progress.
    const existing = await prisma.idempotencyRecord.findUnique({ where: { fingerprint: fp } });
    if (existing && !isExpired(existing.createdAt)) {
      if (existing.statusCode === IN_PROGRESS) {
        res.status(409).json({
          error: 'Identical request already being processed',
          code: 'IDEMPOTENCY_IN_PROGRESS',
        });
        return;
      }
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(existing.statusCode).json(existing.response);
      return;
    }
    // Expired reservation: we take it over for this new attempt.
    await prisma.idempotencyRecord
      .update({
        where: { fingerprint: fp },
        data: { statusCode: IN_PROGRESS, response: {}, createdAt: new Date() },
      })
      .catch(ignoreFailure('[idempotency] expired reservation takeover failed'));
  }

  // Memorises the response at the moment it is sent. Only successes are kept: replaying a transient error (503 from a third-party service, a conflict
  // since resolved) must be able to succeed, otherwise the key would freeze a failure for 24 h — the reservation is then lifted.
  const originalJson = res.json.bind(res);
  let recorded = false;
  res.json = (body: unknown): Response => {
    recorded = res.statusCode >= 200 && res.statusCode < 300;
    if (!recorded) return originalJson(body);

    // Sending is deferred while the response is written. A few milliseconds against a firm guarantee: any replay, even an immediate one, retrieves
    // this body instead of falling back on "processing in progress" — or worse, starting a second processing.
    const status = res.statusCode;
    void prisma.idempotencyRecord
      .update({ where: { fingerprint: fp }, data: { statusCode: status, response: body as object } })
      .catch((err) => logger.warn({ err }, '[idempotency] could not store the response'))
      .finally(() => originalJson(body));
    return res;
  };

  // Safety net: error response, or ended without JSON (204). The reservation must drop, otherwise a legitimate replay would stay stuck on "already in
  // progress" until expiry.
  res.on('finish', () => {
    if (recorded) return;
    void prisma.idempotencyRecord
      .deleteMany({ where: { fingerprint: fp, statusCode: IN_PROGRESS } })
      .catch(ignoreFailure('[idempotency] reservation release failed'));
  });

  next();
}

/** Purges the expired memorised responses (called by the maintenance worker). */
export async function purgeIdempotencyRecords(now = new Date()): Promise<number> {
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_TTL_MS) } },
  });
  return count;
}
