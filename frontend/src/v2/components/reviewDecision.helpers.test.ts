// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { pickPreselectedStatus, reviewStatusStyle } from './reviewDecision.helpers';

describe('reviewStatusStyle', () => {
  it('garde la teinte studio au fond et à la bordure', () => {
    const style = reviewStatusStyle('#2ECC71', true);
    expect(style.backgroundColor).toContain('145'); // teinte du vert d'origine
    expect(style.borderColor).toContain('0.4');
  });

  it('fonce le fond quand sélectionné', () => {
    expect(reviewStatusStyle('#2ECC71', true, true).backgroundColor).toContain('0.28');
    expect(reviewStatusStyle('#2ECC71', true, false).backgroundColor).toContain('0.15');
  });

  it('ramène le texte au seuil de lisibilité du thème', () => {
    // Bleu marine : illisible tel quel sur le thème sombre, il doit être éclairci.
    const dark = reviewStatusStyle('#1b2a5e', true);
    const light = reviewStatusStyle('#1b2a5e', false);
    expect(dark.color).not.toBe(light.color);
    expect(lightnessOf(dark.color)).toBeGreaterThan(lightnessOf(light.color));
  });

  it('retombe sur la couleur brute si elle n’est pas exploitable', () => {
    expect(reviewStatusStyle('pas-une-couleur', true).color).toBe('pas-une-couleur');
  });
});

/** Luminosité (`L%`) d'une couleur `hsl(H S% L%)`. */
function lightnessOf(value: string): number {
  return Number(value.match(/-?[\d.]+/g)![2]);
}

describe('pickPreselectedStatus', () => {
  const statuses = [
    { id: 1, isDefault: false },
    { id: 2, isDefault: true },
    { id: 3, isDefault: false },
  ];
  it('priorise la décision courante', () => {
    expect(pickPreselectedStatus({ id: 3 }, statuses)).toBe(3);
  });
  it('retombe sur le statut par défaut du studio', () => {
    expect(pickPreselectedStatus(null, statuses)).toBe(2);
  });
  it('null sans décision ni défaut', () => {
    expect(pickPreselectedStatus(null, [{ id: 1, isDefault: false }])).toBeNull();
  });
});
