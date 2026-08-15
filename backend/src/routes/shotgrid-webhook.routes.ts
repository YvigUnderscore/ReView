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
 * Réception des webhooks ShotGrid.
 *
 * Route publique — c'est ShotGrid qui appelle, sans session. Trois protections :
 * un jeton opaque dans l'URL (identifie la connexion), une signature HMAC-SHA1 sur le
 * corps brut (prouve l'origine), une limite de débit (absorbe un emballement).
 *
 * ShotGrid exige une réponse en moins de six secondes et compte le temps de réponse
 * dans un quota par site : on accuse réception immédiatement et on traite en file.
 * Un traitement synchrone ferait tomber le débit de livraison de tout le studio.
 */
const router = Router();

/** Corps brut indispensable : la signature porte sur les octets, pas sur l'objet reparsé. */
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
  // Mention du code source : surface accessible sans authentification (AGPL §13).
  res.setHeader('X-Source-Code', await getSourceUrl());

  const token = String(req.params.token ?? '');
  const connection = await prisma.shotgridConnection.findUnique({ where: { webhookToken: token } });
  // Réponse volontairement identique pour un jeton inconnu et une signature fausse :
  // rien ne doit permettre de deviner qu'un jeton existe.
  if (!connection) return res.status(404).json({ error: 'not_found' });

  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''));
  const secret = webhookSecretOf(connection);
  if (secret && !signatureMatches(secret, body, req.header('x-sg-signature') ?? undefined)) {
    logger.warn({ connectionId: connection.id }, 'Webhook ShotGrid : signature invalide');
    return res.status(404).json({ error: 'not_found' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // Accusé de réception immédiat ; la mise en file peut se poursuivre après la réponse.
  res.status(202).json({ accepted: true });

  try {
    await enqueueShotgridEvent(connection.id, payload, {
      deliveryId: req.header('x-sg-delivery-id') ?? null,
      batchId: req.header('x-sg-event-batch-id') ?? null,
    });
  } catch (err) {
    logger.error({ err, connectionId: connection.id }, 'Webhook ShotGrid : mise en file impossible');
  }
});

export default router;
