// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as PushService from '../services/PushService';

/**
 * Web Push (42.B, item 66): VAPID public key, and (un)subscription of a browser.
 * All endpoints require a session (the subscription is bound to the current user).
 */
const router = Router();
router.use(authenticate);

// GET /api/push/key — VAPID public key (null if push is unavailable).
router.get('/key', async (_req, res) => {
  res.json({ publicKey: await PushService.getPublicKey() });
});

/**
 * The endpoint is a URL that the server will itself solicit: we immediately rule out the schemes that
 * have nothing to do there (`file:`, `redis://`…). Refusing internal addresses, for its part, requires
 * resolving the name: that lives in `PushService.saveSubscription`.
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

// POST /api/push/subscribe — registers the current browser's subscription (400 if the target is not a
// public push service: see the service's anti-SSRF guard).
router.post('/subscribe', validate({ body: subscriptionSchema }), async (req, res) => {
  await PushService.saveSubscription(req.user!.id, req.body);
  res.status(204).end();
});

// POST /api/push/unsubscribe — removes a subscription (by endpoint).
router.post(
  '/unsubscribe',
  validate({ body: z.object({ endpoint: z.string().url().max(1000) }) }),
  async (req, res) => {
    // Bound to the owner: otherwise the endpoint alone would suffice to unsubscribe another user's browser
    // (and therefore to deprive them of their notifications).
    await PushService.removeSubscription(req.body.endpoint, req.user!.id);
    res.status(204).end();
  },
);

export default router;
