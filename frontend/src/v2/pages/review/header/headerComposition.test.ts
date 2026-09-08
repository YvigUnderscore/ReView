// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MediaKind } from '../../../types/api';
import {
  chromeHostsHeader,
  headerActions,
  imageCompareOverlay,
  type HeaderActionContext,
} from './headerComposition';

/** Média publié, sans ShotGrid, sans spectateur, sans lecteur détachable. */
const base = (over: Partial<HeaderActionContext> = {}): HeaderActionContext => ({
  kind: 'VIDEO',
  published: true,
  hasSgLink: false,
  hasViewers: false,
  canPictureInPicture: false,
  ...over,
});

const KINDS: MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];

describe('headerActions', () => {
  it('garde les actions communes aux quatre types de média', () => {
    // La fusion ne devait rien perdre : live, décision, théâtre, raccourcis et repli des
    // commentaires étaient sur toutes les reviews avant, ils y sont toujours.
    for (const kind of KINDS)
      expect(headerActions(base({ kind }))).toEqual(
        expect.arrayContaining(['live', 'decision', 'theater', 'shortcuts', 'comments']),
      );
  });

  it("n'offre le sélecteur A/B qu'aux médias plats — la 3D et le splat montent le leur", () => {
    expect(headerActions(base({ kind: 'VIDEO' }))).toContain('compare');
    expect(headerActions(base({ kind: 'IMAGE' }))).toContain('compare');
    expect(headerActions(base({ kind: 'MODEL_3D' }))).not.toContain('compare');
    expect(headerActions(base({ kind: 'SPLAT' }))).not.toContain('compare');
  });

  it("réserve le lecteur détachable à la vidéo, et seulement si la page l'expose", () => {
    expect(headerActions(base({ kind: 'VIDEO', canPictureInPicture: true }))).toContain('pip');
    expect(headerActions(base({ kind: 'VIDEO', canPictureInPicture: false }))).not.toContain('pip');
    expect(headerActions(base({ kind: 'IMAGE', canPictureInPicture: true }))).not.toContain('pip');
    expect(headerActions(base({ kind: 'SPLAT', canPictureInPicture: true }))).not.toContain('pip');
  });

  it('ne propose la publication que sur un brouillon (le verrou de publication est définitif)', () => {
    expect(headerActions(base({ published: false }))).toContain('publish');
    expect(headerActions(base({ published: true }))).not.toContain('publish');
  });

  it('masque ShotGrid et la présence quand il n’y a rien à montrer', () => {
    const bare = headerActions(base());
    expect(bare).not.toContain('shotgrid');
    expect(bare).not.toContain('presence');
    const full = headerActions(base({ hasSgLink: true, hasViewers: true }));
    expect(full).toContain('shotgrid');
    expect(full).toContain('presence');
  });

  it('ordonne l’A/B en premier, pour rejoindre celui des viewers spatiaux', () => {
    // 3D et splat posent leur sélecteur en `headerRight` du chrome, juste devant cette liste.
    expect(headerActions(base({ kind: 'IMAGE' }))[0]).toBe('compare');
  });

  it('ne répète jamais une action', () => {
    const all = headerActions(
      base({ published: false, hasSgLink: true, hasViewers: true, canPictureInPicture: true }),
    );
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('imageCompareOverlay', () => {
  it('ne remplace la visionneuse que sur wipe ou différence, et avec un média B', () => {
    expect(imageCompareOverlay(42, 'wipe')).toBe('wipe');
    expect(imageCompareOverlay(42, 'diff')).toBe('diff');
    expect(imageCompareOverlay(42, 'side')).toBeNull();
    expect(imageCompareOverlay(null, 'wipe')).toBeNull();
  });
});

describe('chromeHostsHeader', () => {
  const host = (over: Partial<Parameters<typeof chromeHostsHeader>[0]> = {}) =>
    chromeHostsHeader({ hasData: true, kind: 'VIDEO', compareId: null, compareMode: 'side', ...over });

  it('confie l’en-tête au chrome pour les quatre types de média', () => {
    for (const kind of KINDS) expect(host({ kind })).toBe(true);
  });

  it('le reprend à la page tant que le média n’est pas chargé', () => {
    expect(host({ hasData: false })).toBe(false);
    expect(host({ hasData: true, kind: undefined })).toBe(false);
  });

  it('le reprend sous une superposition de comparaison image, qui démonte le chrome', () => {
    // Le cas qui aurait fait disparaître l'en-tête fusionné : le wipe et la différence
    // remplacent la visionneuse image — et le chrome qui la portait.
    expect(host({ kind: 'IMAGE', compareId: 7, compareMode: 'wipe' })).toBe(false);
    expect(host({ kind: 'IMAGE', compareId: 7, compareMode: 'diff' })).toBe(false);
    expect(host({ kind: 'IMAGE', compareId: 7, compareMode: 'side' })).toBe(true);
  });

  it('laisse la vidéo dans son chrome, wipe et différence compris — elles y sont en surcouche', () => {
    expect(host({ kind: 'VIDEO', compareId: 7, compareMode: 'wipe' })).toBe(true);
    expect(host({ kind: 'VIDEO', compareId: 7, compareMode: 'diff' })).toBe(true);
  });
});
