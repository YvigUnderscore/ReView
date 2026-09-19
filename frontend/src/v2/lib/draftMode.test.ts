// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isDraftModeOn } from './draftMode';

/**
 * Le verdict du réglage `draftMode`.
 *
 * Ce qui se vérifie : le défaut. Un réglage absent, vide ou illisible doit donner la
 * publication d'office — c'est le comportement que l'utilisateur a choisi, et le lire
 * « allumé » par accident rendrait tous les médias invisibles jusqu'à une publication
 * manuelle que plus personne n'attend.
 */
describe('isDraftModeOn', () => {
  it('est éteint tant que rien ne l’allume explicitement', () => {
    for (const value of [undefined, null, '', '  ', 'false', '0', 'off', 'oui', 'peut-être']) {
      expect(isDraftModeOn(value)).toBe(false);
    }
  });

  it('accepte les trois écritures d’un vrai — la table `Setting` ne stocke que du texte', () => {
    for (const value of ['true', 'TRUE', ' True ', '1', 'on']) {
      expect(isDraftModeOn(value)).toBe(true);
    }
  });

  it('accepte le booléen tel quel — le branding le sert déjà typé', () => {
    expect(isDraftModeOn(true)).toBe(true);
    expect(isDraftModeOn(false)).toBe(false);
  });
});
