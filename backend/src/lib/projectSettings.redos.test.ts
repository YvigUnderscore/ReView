// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { checkNaming, isCatastrophicPattern } from './projectSettings';

/**
 * La convention de nommage est une regex saisie par un gestionnaire de projet, exécutée sur
 * chaque nom de fichier téléversé. Node n'a pas de délai maximal sur une regex : un motif
 * explosif gèle la boucle d'événements, donc toute l'API.
 */
describe('isCatastrophicPattern', () => {
  it('repère les quantificateurs imbriqués', () => {
    for (const p of ['(a+)+$', '(a*)*$', '^(a+)*$', '(\\d+)+x', '(ab{1,9})+'])
      expect(isCatastrophicPattern(p), p).toBe(true);
  });

  // Une regex ne sait pas compter les parenthèses : les versions précédentes de ce contrôle
  // exigeaient un corps de groupe sans parenthèse et laissaient donc passer l'imbrication.
  // `((a+))+` reste exponentiel — 30 caractères suffisent à bloquer la boucle ~13 s.
  it('repère les groupes imbriqués', () => {
    for (const p of ['((a+))+$', '((a|b))+', '(a(b+))*$', '((x|y|xy))+', '(((a+)))+'])
      expect(isCatastrophicPattern(p), p).toBe(true);
  });

  it('ne se laisse pas berner par les classes de caractères ni les échappements', () => {
    // `[+*|]` et `\(` sont littéraux : rien d'ambigu ici.
    for (const p of ['^([+*|])$', '^(\\(a\\))+$', '^([a-z])+$'])
      expect(isCatastrophicPattern(p), p).toBe(false);
  });

  it('repère les alternances quantifiées, quel que soit le nombre de branches', () => {
    for (const p of ['(a|a)*$', '(a|b|ab)*$', '(x|y|z|xy)+', '^(\\d|\\d\\d|\\d\\d\\d)*$'])
      expect(isCatastrophicPattern(p), p).toBe(true);
  });

  it('laisse passer les conventions de nommage réalistes', () => {
    for (const p of [
      '^[A-Z]{3}_\\d{4}_v\\d{3}\\.(exr|mov)$',
      '^shot_\\d+_.+\\.mov$',
      '.*\\.usd[acz]?$',
      '^(SEQ|SHOT)_[0-9]+$',
    ])
      expect(isCatastrophicPattern(p), p).toBe(false);
  });
});

describe('checkNaming', () => {
  it('n’exécute jamais un motif explosif : la convention est désactivée', () => {
    const evil = { pattern: '(a+)+$', mode: 'reject' as const };
    const start = Date.now();
    const r = checkNaming('a'.repeat(40) + '!', evil);
    expect(Date.now() - start).toBeLessThan(1000);
    // Même repli qu'une regex invalide : la convention n'est pas un verrou de sécurité.
    expect(r).toEqual({ pass: true, mode: 'off' });
  });

  it('applique une convention légitime', () => {
    const rule = { pattern: '^[A-Z]{3}_\\d{4}\\.exr$', mode: 'reject' as const };
    expect(checkNaming('ABC_0012.exr', rule)).toEqual({ pass: true, mode: 'reject' });
    expect(checkNaming('nope.exr', rule)).toEqual({ pass: false, mode: 'reject' });
  });

  it('retombe sur off pour une regex invalide ou un mode off', () => {
    expect(checkNaming('x', { pattern: '([', mode: 'reject' })).toEqual({ pass: true, mode: 'off' });
    expect(checkNaming('x', { pattern: '^x$', mode: 'off' })).toEqual({ pass: true, mode: 'off' });
  });
});
