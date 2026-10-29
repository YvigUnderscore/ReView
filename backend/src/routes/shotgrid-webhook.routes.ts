// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, raw } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getSourceUrl } from '../lib/settings';
import { rateLimit } from '../middleware/rateLimit';
import { webhookSecretOf } from '../services/shotgrid/ShotgridConfigService';
import { enqueueShotgridEvent } from '../services/shotgrid/ShotgridEventService';

/**
 * Receiving ShotGrid webhooks.
 *
 * Public route: it is ShotGrid that calls, without a session. Three protections: an opaque token in the
 * URL (identifies the connection), an HMAC-SHA1 signature on the raw body (proves the origin), and a rate
 * limit (absorbs a runaway).
 *
 * ShotGrid requires a response in under six seconds and counts the response time in a quota per site: we
 * acknowledge receipt immediately and process through a queue. A synchronous processing would drop the
 * delivery rate of the whole studio.
 */
const router = Router();

/** Raw body is essential: the signature covers the bytes, not the re-parsed object. */
router.use(raw({ type: '*/*', limit: '5mb' }));

function signatureMatches(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const [algo, provided] = header.split('=');
  if (!provided) return false;
  const digest = createHmac(algo === 'sha256' ? 'sha256' : 'sha1', secret)
    .update(body)
    .digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(provided.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

router.post('/:token', rateLimit({ windowMs: 60_000, max: 600 }), async (req, res) => {
  // Source code notice: surface reachable without authentication (AGPL §13).
  res.setHeader('X-Source-Code', await getSourceUrl());

  const token = String(req.params.token ?? '');
  const connection = await prisma.shotgridConnection.findUnique({ where: { webhookToken: token } });
  /**
   * Deliberately identical response for an unknown token and a wrong signature: nothing must allow
   * guessing that a token exists.
   *
   * The journal, for its part, distinguishes the two, and this is not a comfort detail. A silent
   * integration whose deliveries all came back as 404 left no trace allowing one to know which of the
   * two values had to be corrected: the address or the secret. It is said here, on the side that has the
   * right to know it.
   */
  if (!connection) {
    logger.warn({ tokenLength: token.length }, 'ShotGrid webhook: unknown token (stale address?)');
    return res.status(404).json({ error: 'not_found' });
  }

  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''));
  // An unreadable secret (encryption key changed) is not a wrong signature: letting it surface as a 500
  // would pass a configuration outage off as a site outage.
  let secret: string | null;
  try {
    secret = webhookSecretOf(connection);
  } catch (err) {
    logger.error({ err, connectionId: connection.id }, 'Webhook ShotGrid : secret illisible');
    return res.status(404).json({ error: 'not_found' });
  }
  if (secret && !signatureMatches(secret, body, req.header('x-sg-signature') ?? undefined)) {
    logger.warn(
      { connectionId: connection.id, signed: Boolean(req.header('x-sg-signature')) },
      'ShotGrid webhook: invalid signature — the site secret differs from the connection one',
    );
    return res.status(404).json({ error: 'not_found' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // Immediate acknowledgement; the queuing may continue after the response.
  res.status(202).json({ accepted: true });

  /**
   * ShotGrid's connection test has neither an entity nor a usable event type: it passes through the queue
   * without producing anything. That is precisely the moment when an administrator wants a confirmation:
   * they have just pasted the address and the secret.
   */
  if ((payload as { data?: { event_type?: string } })?.data?.event_type === 'Test_Connection') {
    logger.info({ connectionId: connection.id }, 'ShotGrid webhook: connection test accepted');
  }

  try {
    await enqueueShotgridEvent(connection.id, payload, {
      deliveryId: req.header('x-sg-delivery-id') ?? null,
      batchId: req.header('x-sg-event-batch-id') ?? null,
    });
  } catch (err) {
    logger.error({ err, connectionId: connection.id }, 'ShotGrid webhook: could not enqueue');
  }
});

export default router;
