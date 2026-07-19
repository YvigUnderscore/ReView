import { createHmac } from 'node:crypto';

/**
 * Webhooks sortants (36.D) — helpers PURS (testés) : validation d'URL anti-SSRF,
 * signature HMAC. La persistance/livraison vit dans services/WebhookService.
 */

export const WEBHOOK_EVENTS = ['media.published', 'review.decision', 'comment.created'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

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
