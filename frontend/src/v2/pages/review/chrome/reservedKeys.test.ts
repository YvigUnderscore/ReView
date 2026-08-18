// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { canSwitchModeWith, reservedKeys } from './reservedKeys';

describe('reservedKeys', () => {
  it('réserve la boucle et la navette sur une vidéo', () => {
    expect([...reservedKeys('VIDEO')].sort()).toEqual(['I', 'J', 'K', 'L', 'O']);
  });

  it('ne réserve rien sur les autres médias — ils n’ont pas de transport', () => {
    expect(reservedKeys('IMAGE').size).toBe(0);
    expect(reservedKeys('MODEL_3D').size).toBe(0);
    expect(reservedKeys('SPLAT').size).toBe(0);
  });
});

describe('canSwitchModeWith', () => {
  it('refuse le saut de mode sur une touche du transport', () => {
    // Le cas corrigé : « I » posait la boucle ET basculait tout l'écran en mode Découpe.
    expect(canSwitchModeWith('VIDEO', 'I', false)).toBe(false);
    expect(canSwitchModeWith('VIDEO', 'o', false)).toBe(false);
  });

  it('laisse le mode courant garder ses propres outils', () => {
    // En mode Découpe, « I » pose bien le point d'entrée du trim.
    expect(canSwitchModeWith('VIDEO', 'I', true)).toBe(true);
  });

  it('laisse passer les autres lettres, et tous les médias sans transport', () => {
    expect(canSwitchModeWith('VIDEO', 'D', false)).toBe(true);
    expect(canSwitchModeWith('IMAGE', 'I', false)).toBe(true);
  });
});
