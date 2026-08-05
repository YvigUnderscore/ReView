// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac } from 'node:crypto';

/**
 * Webhooks sortants (36.D) — helpers PURS (testés) : validation d'URL anti-SSRF,
 * signature HMAC. La persistance/livraison vit dans services/WebhookService.
 */

/**
 * Catalogue d'événements (API v1). Les trois premiers existaient avant les intégrations
 * et restent inchangés : un webhook déjà configuré continue de recevoir exactement ce
 * qu'il recevait. Les suivants couvrent le cycle de vie du pipeline, ce dont un bot
 * Discord ou une synchronisation ShotGrid a besoin pour suivre une production.
 */
export const WEBHOOK_EVENTS = [
  'media.published',
  'review.decision',
  'comment.created',
  'comment.resolved',
  'project.created',
  'project.updated',
  'sequence.created',
  'shot.created',
  'shot.updated',
  'asset.created',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'version.created',
  'version.published',
  'media.uploaded',
  'media.failed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Alias public du catalogue — exposé par `/api/v1/schema` aux clients d'intégration. */
export const API_EVENTS = WEBHOOK_EVENTS;

export const isWebhookEvent = (value: string): value is WebhookEvent =>
  (WEBHOOK_EVENTS as readonly string[]).includes(value);

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /\.(local|internal|lan)$/i,
];

/**
 * URL de webhook autorisée ? http(s) uniquement, et jamais vers un hôte privé/loopback
 * (anti-SSRF : l'app ne doit pas pouvoir être pilotée pour frapper son réseau interne).
 * Contrôle par motif d'hôte — la résolution DNS n'est volontairement pas suivie (documenté).
 */
export function isWebhookUrlAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname;
  if (!host || PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return false;
  // Hôte sans point = nom court interne (docker, intranet) → refusé.
  if (!host.includes('.') && !/^\d+$/.test(host)) return false;
  return true;
}

/** Signature `sha256=<hex>` du corps, préfixée du timestamp signé (anti-rejeu). */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
