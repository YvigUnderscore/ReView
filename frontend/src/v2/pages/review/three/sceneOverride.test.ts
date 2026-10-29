// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  addClone,
  clonePath,
  clonesOf,
  countEdits,
  emptyOverride,
  isEmptyEdit,
  isEmptyOverride,
  isHidden,
  isHiddenByAncestor,
  isIdentityTransform,
  isolatePrim,
  mergeOverrides,
  normalizeOverride,
  parseClonePath,
  removeClone,
  setCloneTransform,
  setPrimEdit,
  IDENTITY_TRANSFORM,
  MAX_OVERRIDE_PRIMS,
  type SceneOverride,
} from './sceneOverride';

const moved = {
  t: [1, 2, 3] as [number, number, number],
  r: [0, 0, 0] as [number, number, number],
  s: [1, 1, 1] as [number, number, number],
};

describe('empty shapes', () => {
  it('recognizes the identity transform', () => {
    expect(isIdentityTransform({ t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] })).toBe(true);
    expect(isIdentityTransform(moved)).toBe(false);
  });

  it('recognizes an edit with no effect', () => {
    expect(isEmptyEdit({})).toBe(true);
    expect(isEmptyEdit({ transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } })).toBe(true);
    expect(isEmptyEdit({ variants: {} })).toBe(true);
    expect(isEmptyEdit({ visible: false })).toBe(false);
    expect(isEmptyEdit({ transform: moved })).toBe(false);
  });

  it('recognizes an empty override', () => {
    expect(isEmptyOverride(null)).toBe(true);
    expect(isEmptyOverride(emptyOverride())).toBe(true);
    expect(isEmptyOverride({ version: 1, purpose: 'proxy', prims: {} })).toBe(false);
  });
});

describe('normalizeOverride', () => {
  it('accepts a well-formed value and counts the edited prims', () => {
    const o = normalizeOverride({
      version: 1,
      purpose: 'proxy',
      prims: { '/World/A': { visible: false }, '/World/B': { transform: moved } },
    });
    expect(o.purpose).toBe('proxy');
    expect(countEdits(o)).toBe(2);
  });

  it('rejects malformed entries without ever throwing', () => {
    const o = normalizeOverride({
      purpose: 'unknown',
      prims: {
        'no-slash': { visible: false },
        '/World/A': null,
        '/World/B': { transform: { t: [1, 2], r: [0, 0, 0], s: [1, 1, 1] } },
        '/World/C': { visible: 'yes' },
      },
    });
    expect(o).toEqual(emptyOverride());
    expect(normalizeOverride(undefined)).toEqual(emptyOverride());
    expect(normalizeOverride('nonsense')).toEqual(emptyOverride());
  });

  it('removes edits with no effect (identity, empty variants)', () => {
    const o = normalizeOverride({
      prims: {
        '/W/A': { transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } },
        '/W/B': { variants: {} },
        '/W/C': { variants: { look: 'dirty' } },
      },
    });
    expect(Object.keys(o.prims)).toEqual(['/W/C']);
  });

  it('bounds the number of edited prims', () => {
    const prims: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OVERRIDE_PRIMS + 50; i++) prims[`/W/p${i}`] = { visible: false };
    expect(countEdits(normalizeOverride({ prims }))).toBe(MAX_OVERRIDE_PRIMS);
  });
});

describe('mergeOverrides', () => {
  const base: SceneOverride = {
    version: 1,
    prims: { '/W/A': { transform: moved, variants: { look: 'clean' } } },
  };

  it('a comment proposal overlays field by field', () => {
    const merged = mergeOverrides(base, { version: 1, prims: { '/W/A': { visible: false } } });
    // The transform of the base override survives a proposal that only targets visibility.
    expect(merged.prims['/W/A']).toEqual({
      transform: moved,
      variants: { look: 'clean' },
      visible: false,
    });
  });

  it('the proposal wins on the same field', () => {
    const merged = mergeOverrides(base, {
      version: 1,
      purpose: 'guide',
      prims: { '/W/A': { variants: { look: 'dirty' } } },
    });
    expect(merged.prims['/W/A'].variants).toEqual({ look: 'dirty' });
    expect(merged.purpose).toBe('guide');
  });

  it('tolerates missing layers', () => {
    expect(mergeOverrides(null, null)).toEqual(emptyOverride());
    expect(mergeOverrides(base, null).prims['/W/A'].transform).toEqual(moved);
  });
});

describe('setPrimEdit', () => {
  it('adds, merges and removes without mutating the original', () => {
    const o1 = emptyOverride();
    const o2 = setPrimEdit(o1, '/W/A', { visible: false });
    expect(countEdits(o1)).toBe(0);
    expect(o2.prims['/W/A']).toEqual({ visible: false });

    const o3 = setPrimEdit(o2, '/W/A', { transform: moved });
    expect(o3.prims['/W/A']).toEqual({ visible: false, transform: moved });

    expect(countEdits(setPrimEdit(o3, '/W/A', null))).toBe(0);
  });

  it('removes the entry when the edit becomes meaningless', () => {
    const o = setPrimEdit(emptyOverride(), '/W/A', { transform: moved });
    const reset = setPrimEdit(o, '/W/A', { transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } });
    expect(countEdits(reset)).toBe(0);
  });
});

describe('inherited visibility', () => {
  const o: SceneOverride = { version: 1, prims: { '/W/A': { visible: false } } };

  it('a descendant is hidden by its ancestor', () => {
    expect(isHiddenByAncestor(o, '/W/A/B')).toBe(true);
    expect(isHidden(o, '/W/A/B')).toBe(true);
    // Hidden by inheritance, not in its own right.
    expect(isHiddenByAncestor(o, '/W/A')).toBe(false);
    expect(isHidden(o, '/W/A')).toBe(true);
  });

  it('a neighboring prim is not affected', () => {
    expect(isHidden(o, '/W/B')).toBe(false);
    expect(isHidden(o, '/W/AB')).toBe(false); // neighboring prefix, not a descendant
  });
});

describe('isolatePrim', () => {
  const paths = ['/W', '/W/A', '/W/A/Geo', '/W/B', '/W/B/Geo'];

  it('hides the siblings while keeping the lineage and the descendants', () => {
    const o = isolatePrim(emptyOverride(), '/W/A', paths);
    expect(isHidden(o, '/W')).toBe(false);
    expect(isHidden(o, '/W/A')).toBe(false);
    expect(isHidden(o, '/W/A/Geo')).toBe(false);
    expect(isHidden(o, '/W/B')).toBe(true);
  });

  it('isolating another prim lifts the previous masking', () => {
    const o = isolatePrim(isolatePrim(emptyOverride(), '/W/A', paths), '/W/B', paths);
    expect(isHidden(o, '/W/B')).toBe(false);
    expect(isHidden(o, '/W/A')).toBe(true);
  });

  it('writes one entry per sibling of the lineage — never one per hidden prim', () => {
    // Rich scene: hiding each prim individually exceeded MAX_OVERRIDE_PRIMS and the
    // truncation left half the scene visible (observed on Kitchen_set).
    const big = ['/W', '/W/A', '/W/A/Geo', '/W/B'];
    for (let i = 0; i < 800; i++) big.push(`/W/B/prop${i}`);
    const o = isolatePrim(emptyOverride(), '/W/A/Geo', big);
    // A single entry: `/W/B` hidden; its 800 children inherit without being stored.
    expect(Object.keys(o.prims)).toEqual(['/W/B']);
    expect(isHidden(o, '/W/B/prop42')).toBe(true);
    expect(isHidden(o, '/W/A/Geo')).toBe(false);
  });

  it('hides the top-level prims outside the lineage', () => {
    const o = isolatePrim(emptyOverride(), '/W/A', ['/W', '/W/A', '/Other', '/Other/Geo']);
    expect(isHidden(o, '/Other')).toBe(true);
    expect(isHidden(o, '/Other/Geo')).toBe(true);
    expect(isHidden(o, '/W')).toBe(false);
  });
});

describe('staging clones (C1)', () => {
  it('adds, updates and removes a clone (immutable)', () => {
    let o = addClone(emptyOverride(), '/W/Chair', { id: 'c1', transform: IDENTITY_TRANSFORM });
    expect(clonesOf(o, '/W/Chair')).toHaveLength(1);
    o = setCloneTransform(o, '/W/Chair', 'c1', moved);
    expect(clonesOf(o, '/W/Chair')[0].transform).toEqual(moved);
    o = removeClone(o, '/W/Chair', 'c1');
    // The last clone removed makes the edit empty: the prim disappears from the override.
    expect(isEmptyOverride(o)).toBe(true);
  });

  it('pseudo-path: composition and decomposition', () => {
    const pseudo = clonePath('/W/Chair', 'c1');
    expect(pseudo).toBe('/W/Chair#c1');
    expect(parseClonePath(pseudo)).toEqual({ path: '/W/Chair', id: 'c1' });
    expect(parseClonePath('/W/Chair')).toBeNull();
    expect(parseClonePath('/W/Chair#')).toBeNull();
  });

  it('normalizes: keeps the identity, rejects a missing id, a duplicate or an invalid transform', () => {
    const raw = {
      version: 1,
      prims: {
        '/W': {
          clones: [
            { id: 'a', transform: IDENTITY_TRANSFORM },
            { id: 'a', transform: moved },
            { id: '', transform: moved },
            { id: 'b', transform: { t: [1, 2], r: [0, 0, 0], s: [1, 1, 1] } },
            { id: 'c', transform: moved },
          ],
        },
      },
    };
    const clean = normalizeOverride(raw);
    expect(clonesOf(clean, '/W').map((c) => c.id)).toEqual(['a', 'c']);
    // A clone's identity is meaningful (copy placed at the same spot): kept.
    expect(clonesOf(clean, '/W')[0].transform).toEqual(IDENTITY_TRANSFORM);
  });

  it('merges clones by id (the proposal updates or adds)', () => {
    const base = addClone(emptyOverride(), '/W', { id: 'a', transform: IDENTITY_TRANSFORM });
    const delta = addClone(addClone(emptyOverride(), '/W', { id: 'a', transform: moved }), '/W', {
      id: 'b',
      transform: moved,
    });
    const merged = mergeOverrides(base, delta);
    expect(
      clonesOf(merged, '/W')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(clonesOf(merged, '/W').find((c) => c.id === 'a')!.transform).toEqual(moved);
  });
});
