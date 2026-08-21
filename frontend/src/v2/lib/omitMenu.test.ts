// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isOmitted, omitBody, sequenceIdOf } from './omitMenu';

describe('isOmitted', () => {
  it('lit le drapeau du plan', () => {
    expect(isOmitted({ id: 1, omitted: true })).toBe(true);
    expect(isOmitted({ id: 1, omitted: false })).toBe(false);
  });

  it('tient un plan sans drapeau pour un plan au montage', () => {
    // Un écran qui ne demande pas le champ ne doit pas afficher la case cochée.
    expect(isOmitted({ id: 1 })).toBe(false);
  });
});

describe('omitBody', () => {
  it('bascule le drapeau dans les deux sens', () => {
    expect(omitBody({ id: 1 })).toEqual({ omitted: true });
    expect(omitBody({ id: 1, omitted: true })).toEqual({ omitted: false });
  });

  it('n’envoie que le drapeau', () => {
    // Le reste du plan est édité ailleurs : joindre un champ intact le republierait vers
    // ShotGrid par-dessus une valeur qui a pu bouger entre-temps.
    const body = omitBody({ id: 1, omitted: false, sequenceId: 7 });
    expect(Object.keys(body)).toEqual(['omitted']);
  });
});

describe('sequenceIdOf', () => {
  it('lit la séquence à plat, comme la liste d’un projet la donne', () => {
    expect(sequenceIdOf({ id: 1, sequenceId: 7 })).toBe(7);
  });

  it('lit la séquence imbriquée, comme la fiche d’un plan la donne', () => {
    expect(sequenceIdOf({ id: 1, sequence: { id: 7 } })).toBe(7);
  });

  it('rend null pour un plan hors séquence, quelle que soit la forme', () => {
    expect(sequenceIdOf({ id: 1, sequenceId: null })).toBeNull();
    expect(sequenceIdOf({ id: 1, sequence: null })).toBeNull();
    expect(sequenceIdOf({ id: 1 })).toBeNull();
  });
});
