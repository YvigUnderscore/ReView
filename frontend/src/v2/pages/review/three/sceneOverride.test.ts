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

describe('formes vides', () => {
  it('reconnaît la transformation identité', () => {
    expect(isIdentityTransform({ t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] })).toBe(true);
    expect(isIdentityTransform(moved)).toBe(false);
  });

  it('reconnaît une édition sans effet', () => {
    expect(isEmptyEdit({})).toBe(true);
    expect(isEmptyEdit({ transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } })).toBe(true);
    expect(isEmptyEdit({ variants: {} })).toBe(true);
    expect(isEmptyEdit({ visible: false })).toBe(false);
    expect(isEmptyEdit({ transform: moved })).toBe(false);
  });

  it('reconnaît un override vide', () => {
    expect(isEmptyOverride(null)).toBe(true);
    expect(isEmptyOverride(emptyOverride())).toBe(true);
    expect(isEmptyOverride({ version: 1, purpose: 'proxy', prims: {} })).toBe(false);
  });
});

describe('normalizeOverride', () => {
  it('accepte une valeur bien formée et compte les prims édités', () => {
    const o = normalizeOverride({
      version: 1,
      purpose: 'proxy',
      prims: { '/World/A': { visible: false }, '/World/B': { transform: moved } },
    });
    expect(o.purpose).toBe('proxy');
    expect(countEdits(o)).toBe(2);
  });

  it('rejette les entrées malformées sans jamais lever', () => {
    const o = normalizeOverride({
      purpose: 'inconnu',
      prims: {
        'sans-slash': { visible: false },
        '/World/A': null,
        '/World/B': { transform: { t: [1, 2], r: [0, 0, 0], s: [1, 1, 1] } },
        '/World/C': { visible: 'oui' },
      },
    });
    expect(o).toEqual(emptyOverride());
    expect(normalizeOverride(undefined)).toEqual(emptyOverride());
    expect(normalizeOverride('nawak')).toEqual(emptyOverride());
  });

  it('supprime les éditions sans effet (identité, variantes vides)', () => {
    const o = normalizeOverride({
      prims: {
        '/W/A': { transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } },
        '/W/B': { variants: {} },
        '/W/C': { variants: { look: 'dirty' } },
      },
    });
    expect(Object.keys(o.prims)).toEqual(['/W/C']);
  });

  it('borne le nombre de prims édités', () => {
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

  it('la proposition d’un commentaire se superpose champ par champ', () => {
    const merged = mergeOverrides(base, { version: 1, prims: { '/W/A': { visible: false } } });
    // La transformation de l'override de base survit à une proposition qui ne vise que la visibilité.
    expect(merged.prims['/W/A']).toEqual({
      transform: moved,
      variants: { look: 'clean' },
      visible: false,
    });
  });

  it('la proposition l’emporte sur le même champ', () => {
    const merged = mergeOverrides(base, {
      version: 1,
      purpose: 'guide',
      prims: { '/W/A': { variants: { look: 'dirty' } } },
    });
    expect(merged.prims['/W/A'].variants).toEqual({ look: 'dirty' });
    expect(merged.purpose).toBe('guide');
  });

  it('tolère des étages absents', () => {
    expect(mergeOverrides(null, null)).toEqual(emptyOverride());
    expect(mergeOverrides(base, null).prims['/W/A'].transform).toEqual(moved);
  });
});

describe('setPrimEdit', () => {
  it('ajoute, fusionne et retire sans muter l’original', () => {
    const o1 = emptyOverride();
    const o2 = setPrimEdit(o1, '/W/A', { visible: false });
    expect(countEdits(o1)).toBe(0);
    expect(o2.prims['/W/A']).toEqual({ visible: false });

    const o3 = setPrimEdit(o2, '/W/A', { transform: moved });
    expect(o3.prims['/W/A']).toEqual({ visible: false, transform: moved });

    expect(countEdits(setPrimEdit(o3, '/W/A', null))).toBe(0);
  });

  it('retire l’entrée quand l’édition redevient sans effet', () => {
    const o = setPrimEdit(emptyOverride(), '/W/A', { transform: moved });
    const reset = setPrimEdit(o, '/W/A', { transform: { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } });
    expect(countEdits(reset)).toBe(0);
  });
});

describe('visibilité héritée', () => {
  const o: SceneOverride = { version: 1, prims: { '/W/A': { visible: false } } };

  it('un descendant est masqué par son ancêtre', () => {
    expect(isHiddenByAncestor(o, '/W/A/B')).toBe(true);
    expect(isHidden(o, '/W/A/B')).toBe(true);
    // Masqué par héritage, pas à titre propre.
    expect(isHiddenByAncestor(o, '/W/A')).toBe(false);
    expect(isHidden(o, '/W/A')).toBe(true);
  });

  it('un prim voisin n’est pas affecté', () => {
    expect(isHidden(o, '/W/B')).toBe(false);
    expect(isHidden(o, '/W/AB')).toBe(false); // préfixe voisin, pas descendant
  });
});

describe('isolatePrim', () => {
  const paths = ['/W', '/W/A', '/W/A/Geo', '/W/B', '/W/B/Geo'];

  it('masque les frères en gardant la lignée et la descendance', () => {
    const o = isolatePrim(emptyOverride(), '/W/A', paths);
    expect(isHidden(o, '/W')).toBe(false);
    expect(isHidden(o, '/W/A')).toBe(false);
    expect(isHidden(o, '/W/A/Geo')).toBe(false);
    expect(isHidden(o, '/W/B')).toBe(true);
  });

  it('isoler un autre prim relève le masquage précédent', () => {
    const o = isolatePrim(isolatePrim(emptyOverride(), '/W/A', paths), '/W/B', paths);
    expect(isHidden(o, '/W/B')).toBe(false);
    expect(isHidden(o, '/W/A')).toBe(true);
  });

  it('n’écrit qu’une entrée par frère de la lignée — jamais une par prim masqué', () => {
    // Scène riche : masquer chaque prim individuellement dépassait MAX_OVERRIDE_PRIMS et la
    // troncature laissait la moitié de la scène visible (constaté sur Kitchen_set).
    const big = ['/W', '/W/A', '/W/A/Geo', '/W/B'];
    for (let i = 0; i < 800; i++) big.push(`/W/B/prop${i}`);
    const o = isolatePrim(emptyOverride(), '/W/A/Geo', big);
    // Une seule entrée : `/W/B` masqué ; ses 800 enfants héritent sans être stockés.
    expect(Object.keys(o.prims)).toEqual(['/W/B']);
    expect(isHidden(o, '/W/B/prop42')).toBe(true);
    expect(isHidden(o, '/W/A/Geo')).toBe(false);
  });

  it('masque les prims de premier niveau hors lignée', () => {
    const o = isolatePrim(emptyOverride(), '/W/A', ['/W', '/W/A', '/Other', '/Other/Geo']);
    expect(isHidden(o, '/Other')).toBe(true);
    expect(isHidden(o, '/Other/Geo')).toBe(true);
    expect(isHidden(o, '/W')).toBe(false);
  });
});

describe('clones de mise en scène (C1)', () => {
  it('ajoute, retime et retire un clone (immutable)', () => {
    let o = addClone(emptyOverride(), '/W/Chair', { id: 'c1', transform: IDENTITY_TRANSFORM });
    expect(clonesOf(o, '/W/Chair')).toHaveLength(1);
    o = setCloneTransform(o, '/W/Chair', 'c1', moved);
    expect(clonesOf(o, '/W/Chair')[0].transform).toEqual(moved);
    o = removeClone(o, '/W/Chair', 'c1');
    // Le dernier clone retiré rend l'édition vide : le prim disparaît de l'override.
    expect(isEmptyOverride(o)).toBe(true);
  });

  it('pseudo-chemin : composition et décomposition', () => {
    const pseudo = clonePath('/W/Chair', 'c1');
    expect(pseudo).toBe('/W/Chair#c1');
    expect(parseClonePath(pseudo)).toEqual({ path: '/W/Chair', id: 'c1' });
    expect(parseClonePath('/W/Chair')).toBeNull();
    expect(parseClonePath('/W/Chair#')).toBeNull();
  });

  it('normalise : garde l’identité, rejette id manquant, doublon ou transform invalide', () => {
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
    // Une identité de clone est significative (copie posée au même endroit) : conservée.
    expect(clonesOf(clean, '/W')[0].transform).toEqual(IDENTITY_TRANSFORM);
  });

  it('fusionne les clones par id (la proposition met à jour ou ajoute)', () => {
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
