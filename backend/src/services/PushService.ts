// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import webpush from 'web-push';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest } from '../lib/errors';
import { assertPublicHttpTarget } from '../lib/ssrfGuard';
import { env } from '../config/env';

/**
 * Web Push (42.B, issue #66): per-browser subscriptions and push notification delivery.
 * VAPID keys come from the environment (prod) or are generated and persisted in the database (dev).
 * `sendToUser` is fire-and-forget and purges expired subscriptions (404/410).
 *
 * The subscription endpoint is a URL chosen by the client: `web-push` will POST to it from the
 * application network, where MinIO, Redis, Postgres and 169.254.169.254 answer without network
 * authentication. It therefore goes through the anti-SSRF guard, both at registration (hard refusal,
 * the user is informed) AND at send time, because rows already stored predate this check and a
 * public name may later resolve to an internal address.
 */
export interface PushJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

let publicKey: string | null = null;
let ready: Promise<boolean> | null = null;

async function configure(): Promise<boolean> {
  let pub = env.VAPID_PUBLIC_KEY;
  let priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const stored = await prisma.setting.findUnique({ where: { key: 'vapid_keys' } });
    if (stored) {
      const parsed = JSON.parse(stored.value) as { publicKey: string; privateKey: string };
      pub = parsed.publicKey;
      priv = parsed.privateKey;
    } else {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      await prisma.setting.create({ data: { key: 'vapid_keys', value: JSON.stringify(keys) } });
      logger.info('[push] paire VAPID générée et persistée (dev)');
    }
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT ?? 'mailto:admin@review.local', pub, priv);
  publicKey = pub;
  return true;
}

/** Configures web-push once (memoized). */
function ensureConfigured(): Promise<boolean> {
  if (!ready)
    ready = configure().catch((err) => {
      logger.warn({ err }, '[push] configuration VAPID impossible');
      ready = null;
      return false;
    });
  return ready;
}

/** Returns the VAPID public key (base64url) for browser subscription, or null if unavailable. */
export async function getPublicKey(): Promise<string | null> {
  await ensureConfigured();
  return publicKey;
}

/**
 * Tells whether the endpoint points to a public push service. Returns the refusal reason, or `null`.
 * The check applies to the RESOLVED ADDRESS: `https://push.example.com` can point to
 * 127.0.0.1 just as `http://10.0.0.5/` can.
 */
async function refuseReason(endpoint: string): Promise<string | null> {
  const verdict = await assertPublicHttpTarget(endpoint);
  return verdict.ok ? null : verdict.reason;
}

export async function saveSubscription(userId: number, sub: PushJson): Promise<void> {
  const reason = await refuseReason(sub.endpoint);
  if (reason) {
    logger.warn({ userId, reason }, '[push] endpoint refusé');
    throw badRequest(`Push endpoint refused: ${reason}`, 'PUSH_ENDPOINT_REFUSED');
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function removeSubscription(endpoint: string, userId?: number): Promise<void> {
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, ...(userId != null ? { userId } : {}) },
  });
}

/** Sends a push notification to all devices of a user (non-blocking). */
export function sendToUser(userId: number, payload: { title: string; body: string; url?: string }): void {
  void (async () => {
    if (!(await ensureConfigured())) return;
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(
      subs.map(async (s) => {
        // Second check, at send time: the row may predate the guard, or the name may have
        // resolved differently since the subscription was made.
        const reason = await refuseReason(s.endpoint);
        if (reason) {
          logger.warn({ subscriptionId: s.id, reason }, '[push] envoi refusé (cible non publique)');
          return;
        }
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          } else {
            logger.warn({ err }, '[push] envoi échoué');
          }
        }
      }),
    );
  })().catch((err) => logger.warn({ err }, '[push] notification échouée'));
}
