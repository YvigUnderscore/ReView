// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import webpush from 'web-push';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest } from '../lib/errors';
import { assertPublicHttpTarget } from '../lib/ssrfGuard';
import { env } from '../config/env';

/**
 * Web Push (42.B — №66) : abonnements par navigateur + envoi de notifications push.
 * Les clés VAPID viennent de l'env (prod) ou sont générées et persistées en base (dev).
 * `sendToUser` est fire-and-forget et purge les abonnements expirés (404/410).
 *
 * L'endpoint d'abonnement est une URL choisie par le client : `web-push` y émettra un POST
 * depuis le réseau applicatif, où MinIO, Redis, Postgres et 169.254.169.254 répondent sans
 * authentification réseau. Il passe donc par la garde anti-SSRF — à l'enregistrement (refus
 * net, l'utilisateur en est informé) ET à l'envoi, parce que les lignes déjà en base sont
 * antérieures à ce contrôle et qu'un nom public peut se mettre à résoudre en interne.
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

/** Configure web-push une seule fois (mémoïsé). */
function ensureConfigured(): Promise<boolean> {
  if (!ready)
    ready = configure().catch((err) => {
      logger.warn({ err }, '[push] configuration VAPID impossible');
      ready = null;
      return false;
    });
  return ready;
}

/** Clé publique VAPID (base64url) pour l'abonnement côté navigateur, ou null si indisponible. */
export async function getPublicKey(): Promise<string | null> {
  await ensureConfigured();
  return publicKey;
}

/**
 * L'endpoint désigne-t-il un service de push public ? Rend le motif de refus, ou `null`.
 * Le contrôle porte sur l'ADRESSE RÉSOLUE : `https://push.exemple.com` peut pointer sur
 * 127.0.0.1 tout comme `http://10.0.0.5/`.
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

/** Envoie une notification push à tous les appareils d'un utilisateur (sans bloquer). */
export function sendToUser(userId: number, payload: { title: string; body: string; url?: string }): void {
  void (async () => {
    if (!(await ensureConfigured())) return;
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(
      subs.map(async (s) => {
        // Second contrôle, à l'instant de l'envoi : la ligne peut dater d'avant la garde,
        // ou le nom avoir changé de résolution depuis l'abonnement.
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
