// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';

/** Helpers purs du journal de livraison des webhooks (statuts, extraits, portée) — testés. */

export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export interface WebhookDeliveryRow {
  id: number;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  apiEventId: number | null;
  replayOfId: number | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhookScopeRow {
  active: boolean;
  projectId: number | null;
  failureStreak: number;
}

/** Doit rester aligné sur `WebhookService.FAILURE_STREAK_LIMIT` (backend). */
export const FAILURE_STREAK_LIMIT = 5;

const STATUS_KEYS: Record<WebhookDeliveryStatus, MessageKey> = {
  PENDING: 'webhooks.delivery.pending',
  DELIVERED: 'webhooks.delivery.delivered',
  FAILED: 'webhooks.delivery.failed',
};

const STATUS_TONES: Record<WebhookDeliveryStatus, 'warning' | 'success' | 'destructive'> = {
  PENDING: 'warning',
  DELIVERED: 'success',
  FAILED: 'destructive',
};

export const deliveryStatusKey = (status: WebhookDeliveryStatus): MessageKey => STATUS_KEYS[status];
export const deliveryTone = (status: WebhookDeliveryStatus) => STATUS_TONES[status];

/**
 * Une livraison ne se rejoue que si elle a échoué. Rejouer une remise crée un doublon chez
 * le consommateur ; rejouer une livraison encore en cours de reprise en crée deux.
 */
export const canReplay = (row: WebhookDeliveryRow): boolean => row.status === 'FAILED';

/**
 * Ce qu'on montre du corps de réponse : une ligne, sans blancs superflus. La réponse est
 * déjà tronquée côté serveur ; ici il s'agit seulement de tenir sur une ligne de tableau.
 */
export function responseExcerpt(row: WebhookDeliveryRow, max = 120): string {
  const raw = (row.error ?? row.responseBody ?? '').replace(/\s+/g, ' ').trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

/**
 * Webhook éteint par le serveur après des pertes répétées. On le distingue d'un webhook
 * simplement décoché : le premier demande de réparer l'endpoint, le second pas.
 */
export const isSilencedByFailures = (hook: WebhookScopeRow): boolean =>
  !hook.active && hook.failureStreak >= FAILURE_STREAK_LIMIT;

/** Nom de projet d'un webhook, ou `null` pour la portée « tout le studio ». */
export function scopeName(
  hook: Pick<WebhookScopeRow, 'projectId'>,
  projects: ReadonlyArray<{ id: number; name: string }>,
): string | null {
  if (hook.projectId === null) return null;
  return projects.find((p) => p.id === hook.projectId)?.name ?? `#${hook.projectId}`;
}
