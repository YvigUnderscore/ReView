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
  it('associe une clé de libellé et une teinte à chaque statut', () => {
    expect(deliveryStatusKey('DELIVERED')).toBe('webhooks.delivery.delivered');
    expect(deliveryTone('DELIVERED')).toBe('success');
    expect(deliveryTone('FAILED')).toBe('destructive');
    expect(deliveryTone('PENDING')).toBe('warning');
  });
});

describe('rejeu', () => {
  it('ne se propose que sur un échec', () => {
    expect(canReplay(row())).toBe(true);
    expect(canReplay(row({ status: 'DELIVERED' }))).toBe(false);
    // Encore en reprise : rejouer maintenant ferait deux appels chez le consommateur.
    expect(canReplay(row({ status: 'PENDING' }))).toBe(false);
  });
});

describe('extrait de réponse', () => {
  it('préfère le motif d’erreur au corps, et compacte les blancs', () => {
    expect(responseExcerpt(row({ error: 'HTTP  500\n', responseBody: 'ignoré' }))).toBe('HTTP 500');
    expect(responseExcerpt(row({ responseBody: '  {"ok":\n false}  ' }))).toBe('{"ok": false}');
  });

  it('rend une chaîne vide quand il n’y a rien à montrer', () => {
    expect(responseExcerpt(row())).toBe('');
  });

  it('tronque au-delà de la longueur demandée', () => {
    const out = responseExcerpt(row({ error: 'x'.repeat(300) }), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('webhook éteint par le serveur', () => {
  it('distingue la désactivation automatique du simple décochage', () => {
    expect(
      isSilencedByFailures({ active: false, projectId: null, failureStreak: FAILURE_STREAK_LIMIT }),
    ).toBe(true);
    expect(isSilencedByFailures({ active: false, projectId: null, failureStreak: 0 })).toBe(false);
    expect(isSilencedByFailures({ active: true, projectId: null, failureStreak: 99 })).toBe(false);
  });
});

describe('portée', () => {
  const projects = [{ id: 4, name: 'Le Voyage' }];

  it('rend null pour un webhook de studio', () => {
    expect(scopeName({ projectId: null }, projects)).toBeNull();
  });

  it('rend le nom du projet, et son identifiant à défaut', () => {
    expect(scopeName({ projectId: 4 }, projects)).toBe('Le Voyage');
    expect(scopeName({ projectId: 9 }, projects)).toBe('#9');
  });
});
