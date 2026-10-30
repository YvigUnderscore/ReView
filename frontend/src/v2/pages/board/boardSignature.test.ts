// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { sceneSignature } from './boardSignature';
import type { BoardFiles } from './boardFiles';

const noFiles = {} as BoardFiles;
const el = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id,
  version,
  versionNonce: 1,
  ...extra,
});

describe('sceneSignature', () => {
  it('returns the same fingerprint for two distinct objects with the same content', () => {
    // That is the whole point: `onChange` rebuilds new objects on each call, and
    // comparison by identity made it look like a change on every render.
    const a = sceneSignature([el('a', 3), el('b', 1)], noFiles);
    const b = sceneSignature([el('a', 3), el('b', 1)], noFiles);
    expect(a).toBe(b);
  });

  it('ignores properties that move without the scene changing', () => {
    const avant = sceneSignature([el('a', 3, { x: 10, seed: 111 })], noFiles);
    const apres = sceneSignature([el('a', 3, { x: 10, seed: 222 })], noFiles);
    expect(apres).toBe(avant);
  });

  it('changes when an element is really modified', () => {
    const avant = sceneSignature([el('a', 3)], noFiles);
    expect(sceneSignature([el('a', 4)], noFiles)).not.toBe(avant);
  });

  it('changes when an element is added, removed or deleted', () => {
    const base = sceneSignature([el('a', 3)], noFiles);
    expect(sceneSignature([el('a', 3), el('b', 1)], noFiles)).not.toBe(base);
    expect(sceneSignature([], noFiles)).not.toBe(base);
    expect(sceneSignature([el('a', 3, { isDeleted: true })], noFiles)).not.toBe(base);
  });

  it('tracks file identifiers, not their content or order', () => {
    const f1 = { x: { id: 'x', dataURL: 'data:1' }, y: { id: 'y' } } as unknown as BoardFiles;
    const f2 = { y: { id: 'y' }, x: { id: 'x', dataURL: 'data:AUTRE' } } as unknown as BoardFiles;
    expect(sceneSignature([], f2)).toBe(sceneSignature([], f1));
    expect(sceneSignature([], { x: { id: 'x' } } as unknown as BoardFiles)).not.toBe(sceneSignature([], f1));
  });

  it('an empty scene has a stable fingerprint', () => {
    expect(sceneSignature([], noFiles)).toBe(sceneSignature([], noFiles));
  });

  it('falls back to content when an element does not have the expected shape', () => {
    expect(sceneSignature([{ sans: 'id' }], noFiles)).not.toBe(sceneSignature([{ autre: 'forme' }], noFiles));
  });
});
