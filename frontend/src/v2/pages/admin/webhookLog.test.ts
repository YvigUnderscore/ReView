// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  canReplay,
  deliveryStatusKey,
  deliveryTone,
  FAILURE_STREAK_LIMIT,
  isSilencedByFailures,
  responseExcerpt,
  scopeName,
  type WebhookDeliveryRow,
} from './webhookLog';

const row = (over: Partial<WebhookDeliveryRow> = {}): WebhookDeliveryRow => ({
  id: 1,
  event: 'version.published',
  status: 'FAILED',
  attempts: 5,
  responseStatus: 500,
  responseBody: null,
  error: null,
  apiEventId: null,
  replayOfId: null,
  createdAt: '2026-08-22T10:00:00.000Z',
  deliveredAt: null,
  ...over,
});

describe('statuts de livraison', () => {
  it('maps a label key and a tint to each status', () => {
    expect(deliveryStatusKey('DELIVERED')).toBe('webhooks.delivery.delivered');
    expect(deliveryTone('DELIVERED')).toBe('success');
    expect(deliveryTone('FAILED')).toBe('destructive');
    expect(deliveryTone('PENDING')).toBe('warning');
  });
});

describe('rejeu', () => {
  it('is offered only on a failure', () => {
    expect(canReplay(row())).toBe(true);
    expect(canReplay(row({ status: 'DELIVERED' }))).toBe(false);
    // Still being retried: replaying now would make two calls on the consumer's side.
    expect(canReplay(row({ status: 'PENDING' }))).toBe(false);
  });
});

describe('response excerpt', () => {
  it('prefers the error reason to the body, and compacts whitespace', () => {
    expect(responseExcerpt(row({ error: 'HTTP  500\n', responseBody: 'ignored' }))).toBe('HTTP 500');
    expect(responseExcerpt(row({ responseBody: '  {"ok":\n false}  ' }))).toBe('{"ok": false}');
  });

  it('returns an empty string when there is nothing to show', () => {
    expect(responseExcerpt(row())).toBe('');
  });

  it('truncates beyond the requested length', () => {
    const out = responseExcerpt(row({ error: 'x'.repeat(300) }), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('webhook switched off by the server', () => {
  it('tells automatic deactivation apart from a simple untick', () => {
    expect(
      isSilencedByFailures({ active: false, projectId: null, failureStreak: FAILURE_STREAK_LIMIT }),
    ).toBe(true);
    expect(isSilencedByFailures({ active: false, projectId: null, failureStreak: 0 })).toBe(false);
    expect(isSilencedByFailures({ active: true, projectId: null, failureStreak: 99 })).toBe(false);
  });
});

describe('scope', () => {
  const projects = [{ id: 4, name: 'Le Voyage' }];

  it('returns null for a studio webhook', () => {
    expect(scopeName({ projectId: null }, projects)).toBeNull();
  });

  it('returns the project name, or its identifier as a fallback', () => {
    expect(scopeName({ projectId: 4 }, projects)).toBe('Le Voyage');
    expect(scopeName({ projectId: 9 }, projects)).toBe('#9');
  });
});
