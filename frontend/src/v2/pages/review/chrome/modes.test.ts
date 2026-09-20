// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MediaKind, Role } from '../../../types/api';
import { DEFAULT_MODE, allowedModesFor, canSwitchMode, modesFor, switcherModesFor } from './modes';

const KINDS: MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];
const INTERNAL: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST'];

describe('canSwitchMode', () => {
  it('refuse la bascule au client, pour tous les types de média', () => {
    // Le client reste en exploration, en lecture seule : la bascule n'apparaît pas dans
    // l'en-tête fusionné, quel que soit le nombre de modes du média.
    for (const kind of KINDS) expect(canSwitchMode('CLIENT', switcherModesFor(kind).length)).toBe(false);
  });

  it('l’offre aux rôles internes dès qu’il y a plus d’un mode', () => {
    for (const role of INTERNAL)
      for (const kind of KINDS) expect(canSwitchMode(role, switcherModesFor(kind).length)).toBe(true);
  });

  it('la masque quand un seul mode reste — un segment unique ne bascule vers rien', () => {
    // Le lecteur de montage n'a que « regarder ».
    expect(canSwitchMode('ADMIN', 1)).toBe(false);
    expect(canSwitchMode('ADMIN', 0)).toBe(false);
  });
});

describe('switcherModesFor', () => {
  it('ne liste jamais « Annoter » — l’annotation s’arme depuis l’espace commentaire', () => {
    for (const kind of KINDS) {
      expect(modesFor(kind).map((m) => m.value)).toContain('annotate');
      expect(switcherModesFor(kind).map((m) => m.value)).not.toContain('annotate');
    }
  });

  it('garde le mode par défaut en tête de bascule pour les quatre types', () => {
    for (const kind of KINDS) expect(switcherModesFor(kind)[0]?.value).toBe(DEFAULT_MODE);
  });

  it('donne les mêmes modes à la vidéo et à l’image, et la mise en scène aux spatiaux', () => {
    // La découpe vidéo a été retirée (Phase 50) : les deux médias plats portent désormais la
    // même bascule. Ce test disait l'inverse — il est réécrit, pas désactivé.
    expect(switcherModesFor('VIDEO').map((m) => m.value)).toEqual(
      switcherModesFor('IMAGE').map((m) => m.value),
    );
    expect(switcherModesFor('MODEL_3D').map((m) => m.value)).toContain('stage');
    expect(switcherModesFor('SPLAT').map((m) => m.value)).toContain('stage');
  });
});

describe('allowedModesFor — « Compare » exige une version voisine', () => {
  it('retire le segment quand il n’y a rien à comparer', () => {
    expect(switcherModesFor('IMAGE', false).map((m) => m.value)).toEqual(['explore']);
    // Depuis le retrait de la découpe, la vidéo est logée à la même enseigne : sans version
    // voisine, il ne lui reste que « Regarder ».
    expect(switcherModesFor('VIDEO', false).map((m) => m.value)).toEqual(['explore']);
  });

  it('laisse la bascule disparaître quand un média plat n’a plus qu’un mode', () => {
    // Sans version voisine, il ne reste que « Regarder » : un segment unique ne bascule vers
    // rien, et la bascule s'efface au lieu de se montrer inerte.
    for (const kind of ['IMAGE', 'VIDEO'] as const) {
      expect(canSwitchMode('ARTIST', switcherModesFor(kind, false).length)).toBe(false);
      expect(canSwitchMode('ARTIST', switcherModesFor(kind, true).length)).toBe(true);
    }
  });

  it('ne touche pas aux médias spatiaux, qui n’ont pas ce mode', () => {
    for (const kind of ['MODEL_3D', 'SPLAT'] as const)
      expect(allowedModesFor(kind, false).map((m) => m.value)).toEqual(modesFor(kind).map((m) => m.value));
  });
});
