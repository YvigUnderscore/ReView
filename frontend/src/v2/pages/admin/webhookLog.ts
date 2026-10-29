// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';

/** Pure helpers for the webhook delivery log (statuses, excerpts, scope) — tested. */

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

/** Must stay aligned with `WebhookService.FAILURE_STREAK_LIMIT` (backend). */
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
 * A delivery is only replayed if it failed. Replaying a delivery that succeeded creates a duplicate on
 * the consumer's side; replaying one still being retried creates two.
 */
export const canReplay = (row: WebhookDeliveryRow): boolean => row.status === 'FAILED';

/**
 * What we show of the response body: one line, without superfluous whitespace. The response is
 * already truncated server-side; here it only has to fit on one table line.
 */
export function responseExcerpt(row: WebhookDeliveryRow, max = 120): string {
  const raw = (row.error ?? row.responseBody ?? '').replace(/\s+/g, ' ').trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

/**
 * Webhook switched off by the server after repeated losses. It is told apart from a
 * webhook simply unticked: the former asks for the endpoint to be repaired, the latter does not.
 */
export const isSilencedByFailures = (hook: WebhookScopeRow): boolean =>
  !hook.active && hook.failureStreak >= FAILURE_STREAK_LIMIT;

/** Project name of a webhook, or `null` for the "whole studio" scope. */
export function scopeName(
  hook: Pick<WebhookScopeRow, 'projectId'>,
  projects: ReadonlyArray<{ id: number; name: string }>,
): string | null {
  if (hook.projectId === null) return null;
  return projects.find((p) => p.id === hook.projectId)?.name ?? `#${hook.projectId}`;
}
