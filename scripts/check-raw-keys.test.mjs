// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { SPEAKING_CALLS, VISIBLE_PROPS, isKeyProp, isMessageKeyType } from './check-raw-keys.mjs';

/**
 * The heart of the check is a predicate on TypeScript *types*; so we feed it stub types that
 * only implement what it queries (union, string literal, value).
 * No need for the full checker to prove the rule.
 */
const literal = (value) => ({ isUnion: () => false, isStringLiteral: () => true, value });
const union = (...parts) => ({ isUnion: () => true, types: parts });
const widened = () => ({ isUnion: () => false, isStringLiteral: () => false });

const KEYS = new Set(['task.status.todo', 'task.status.done', 'projects.title']);

describe('isMessageKeyType', () => {
  it('reports a literal that is a catalogue key', () => {
    expect(isMessageKeyType(literal('task.status.todo'), KEYS)).toBe(true);
  });

  it('lets through a literal absent from the catalogue', () => {
    expect(isMessageKeyType(literal('To do'), KEYS)).toBe(false);
  });

  it('reports a union whose branches are all keys', () => {
    expect(isMessageKeyType(union(literal('task.status.todo'), literal('task.status.done')), KEYS)).toBe(
      true,
    );
  });

  it('lets through a union where only one branch is a key', () => {
    expect(isMessageKeyType(union(literal('task.status.todo'), literal('already translated')), KEYS)).toBe(false);
  });

  it('lets through a widened `string` type — it may already carry the translation', () => {
    expect(isMessageKeyType(widened(), KEYS)).toBe(false);
  });

  it('lets through an empty union rather than declaring it entirely keys', () => {
    expect(isMessageKeyType(union(), KEYS)).toBe(false);
  });
});

describe('isKeyProp', () => {
  it('recognises the props that deliberately carry a key', () => {
    expect(isKeyProp('labelKey')).toBe(true);
    expect(isKeyProp('emptyKey')).toBe(true);
  });

  it('does not confuse them with an ordinary label prop', () => {
    expect(isKeyProp('label')).toBe(false);
    expect(isKeyProp('keyboard')).toBe(false);
  });
});

describe('inventaires', () => {
  it('covers the usual visible props', () => {
    for (const prop of ['label', 'title', 'placeholder', 'alt', 'aria-label']) {
      expect(VISIBLE_PROPS.has(prop), prop).toBe(true);
    }
  });

  it('covers the functions that speak to the user', () => {
    for (const call of ['toast', 'alert', 'confirm', 'error', 'success']) {
      expect(SPEAKING_CALLS.has(call), call).toBe(true);
    }
  });
});
