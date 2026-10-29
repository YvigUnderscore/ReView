// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac } from 'node:crypto';

/**
 * Outgoing webhooks (36.D): PURE helpers (tested), covering anti-SSRF URL validation and the HMAC
 * signature. Persistence and delivery live in services/WebhookService.
 */

/**
 * Event catalog (API v1). The first three existed before the integrations and remain unchanged:
 * a webhook already configured keeps receiving exactly what it received. The following ones cover
 * the pipeline lifecycle, what a Discord bot or a ShotGrid sync needs to follow a production.
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
  // Who must look at a version, and the instruction given to each. Emitted on every write: a
  // production bot knows whom to chase, and an external dashboard sees a request arrive without
  // polling the API in a loop.
  'version.reviewers_changed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Public alias of the catalog, exposed by `/api/v1/schema` to integration clients. */
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
 * Is this webhook URL allowed? http(s) only, and never to a private or loopback host
 * (anti-SSRF: the app must not be steerable into hitting its internal network).
 * Checked by host pattern: DNS resolution is deliberately not followed (documented).
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
  // Host without a dot = short internal name (docker, intranet): refused.
  if (!host.includes('.') && !/^\d+$/.test(host)) return false;
  return true;
}

/** Signature `sha256=<hex>` of the body, prefixed with the signed timestamp (anti-replay). */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
