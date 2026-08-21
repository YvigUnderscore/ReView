// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { MEDIA_STUCK_AFTER_MS, reconcileAction, reconcileFailureMessage } from './mediaReconcile';

const candidate = (over: Partial<Parameters<typeof reconcileAction>[0]> = {}) => ({
  id: 1,
  ageMs: MEDIA_STUCK_AFTER_MS + 1,
  hasLiveJob: false,
  ...over,
});

describe('reconcileAction', () => {
  it('un job vivant protège le média, même très ancien', () => {
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 48 * 3600_000 }))).toBe('skip');
  });

  it('un média récent est épargné : le balayage ne court pas plus vite que l’enfilage', () => {
    expect(reconcileAction(candidate({ ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ ageMs: MEDIA_STUCK_AFTER_MS - 1 }))).toBe('skip');
  });

  it('ancien et sans job vivant : échec explicite', () => {
    expect(reconcileAction(candidate({ ageMs: MEDIA_STUCK_AFTER_MS }))).toBe('fail');
    expect(reconcileAction(candidate({ ageMs: 3 * MEDIA_STUCK_AFTER_MS }))).toBe('fail');
  });

  it('le seuil est paramétrable', () => {
    expect(reconcileAction(candidate({ ageMs: 5000 }), 1000)).toBe('fail');
    expect(reconcileAction(candidate({ ageMs: 500 }), 1000)).toBe('skip');
  });

  it('les deux conditions doivent être réunies', () => {
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: false, ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 1e9 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: false, ageMs: 1e9 }))).toBe('fail');
  });
});

describe('reconcileFailureMessage', () => {
  it('message actionnable, en anglais, avec la durée en minutes', () => {
    expect(reconcileFailureMessage(90 * 60_000)).toContain('90 min');
    expect(reconcileFailureMessage(90 * 60_000)).toMatch(/^Processing was interrupted/);
  });

  it('jamais « 0 min » : un plancher d’une minute', () => {
    expect(reconcileFailureMessage(1200)).toContain('1 min');
  });

  it('tient dans les 500 caractères conservés par le worker', () => {
    expect(reconcileFailureMessage(10 ** 9).length).toBeLessThan(500);
  });
});
