// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { SPEAKING_CALLS, VISIBLE_PROPS, isKeyProp, isMessageKeyType } from './check-raw-keys.mjs';

/**
 * Le cœur du contrôle est un prédicat sur les *types* TypeScript ; on lui présente donc des
 * types factices qui n'implémentent que ce qu'il interroge (union, littéral de chaîne, valeur).
 * Pas besoin du vérificateur complet pour prouver la règle.
 */
const literal = (value) => ({ isUnion: () => false, isStringLiteral: () => true, value });
const union = (...parts) => ({ isUnion: () => true, types: parts });
const widened = () => ({ isUnion: () => false, isStringLiteral: () => false });

const KEYS = new Set(['task.status.todo', 'task.status.done', 'projects.title']);

describe('isMessageKeyType', () => {
  it('signale un littéral qui est une clé du catalogue', () => {
    expect(isMessageKeyType(literal('task.status.todo'), KEYS)).toBe(true);
  });

  it('laisse passer un littéral absent du catalogue', () => {
    expect(isMessageKeyType(literal('À faire'), KEYS)).toBe(false);
  });

  it('signale une union dont toutes les branches sont des clés', () => {
    expect(isMessageKeyType(union(literal('task.status.todo'), literal('task.status.done')), KEYS)).toBe(
      true,
    );
  });

  it('laisse passer une union dont une seule branche est une clé', () => {
    expect(isMessageKeyType(union(literal('task.status.todo'), literal('déjà traduit')), KEYS)).toBe(false);
  });

  it('laisse passer un type `string` élargi — il peut déjà porter la traduction', () => {
    expect(isMessageKeyType(widened(), KEYS)).toBe(false);
  });

  it('laisse passer une union vide plutôt que de la déclarer entièrement clé', () => {
    expect(isMessageKeyType(union(), KEYS)).toBe(false);
  });
});

describe('isKeyProp', () => {
  it('reconnaît les props qui transportent volontairement une clé', () => {
    expect(isKeyProp('labelKey')).toBe(true);
    expect(isKeyProp('emptyKey')).toBe(true);
  });

  it('ne confond pas avec une prop de libellé ordinaire', () => {
    expect(isKeyProp('label')).toBe(false);
    expect(isKeyProp('keyboard')).toBe(false);
  });
});

describe('inventaires', () => {
  it('couvre les props visibles usuelles', () => {
    for (const prop of ['label', 'title', 'placeholder', 'alt', 'aria-label']) {
      expect(VISIBLE_PROPS.has(prop), prop).toBe(true);
    }
  });

  it('couvre les fonctions qui parlent à l’utilisateur', () => {
    for (const call of ['toast', 'alert', 'confirm', 'error', 'success']) {
      expect(SPEAKING_CALLS.has(call), call).toBe(true);
    }
  });
});
