// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as PushService from '../services/PushService';

/**
 * Web Push (42.B — №66) : clé publique VAPID + (dés)abonnement d'un navigateur.
 * Tous les endpoints exigent une session (l'abonnement est lié à l'utilisateur courant).
 */
const router = Router();
router.use(authenticate);

// GET /api/push/key — clé publique VAPID (null si push indisponible).
router.get('/key', async (_req, res) => {
  res.json({ publicKey: await PushService.getPublicKey() });
});

/**
 * L'endpoint est une URL que le serveur ira solliciter lui-même : on écarte d'emblée les
 * schémas qui n'ont rien à faire là (`file:`, `redis://`…). Le refus des adresses internes,
 * lui, exige de résoudre le nom — il vit dans `PushService.saveSubscription`.
 */
const httpUrl = z
  .string()
  .url()
  .max(1000)
  .refine((v) => /^https?:$/.test(new URL(v).protocol), 'endpoint must be an http(s) URL');

const subscriptionSchema = z.object({
  endpoint: httpUrl,
  keys: z.object({ p256dh: z.string().max(255), auth: z.string().max(255) }),
});

// POST /api/push/subscribe — enregistre l'abonnement du navigateur courant (400 si la
// cible n'est pas un service de push public : voir la garde anti-SSRF du service).
router.post('/subscribe', validate({ body: subscriptionSchema }), async (req, res) => {
  await PushService.saveSubscription(req.user!.id, req.body);
  res.status(204).end();
});

// POST /api/push/unsubscribe — retire un abonnement (par endpoint).
router.post(
  '/unsubscribe',
  validate({ body: z.object({ endpoint: z.string().url().max(1000) }) }),
  async (req, res) => {
    // Borné au propriétaire : l'endpoint seul suffirait sinon à désinscrire le navigateur
    // d'un autre utilisateur (et donc à le priver de ses notifications).
    await PushService.removeSubscription(req.body.endpoint, req.user!.id);
    res.status(204).end();
  },
);

export default router;
