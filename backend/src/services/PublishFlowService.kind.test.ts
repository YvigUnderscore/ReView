// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { MediaKind } from '@prisma/client';

// Le service tire tout le pipeline média (stockage, files) : on ne teste ici que la
// déduction de type, fonction pure, en neutralisant les modules à effets de bord.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./MediaService', () => ({}));
vi.mock('./PipelineEnsureService', () => ({}));
vi.mock('./PipelineResolveService', () => ({}));
vi.mock('./VersionService', () => ({}));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));

import { inferMediaKind } from './PublishFlowService';

describe('inferMediaKind', () => {
  it('reconnaît les conteneurs vidéo de production', () => {
    for (const f of ['shot.mov', 'playblast.mp4', 'master.mxf', 'take.webm']) {
      expect(inferMediaKind(f)).toBe(MediaKind.VIDEO);
    }
  });

  it('reconnaît les images, formats de production compris', () => {
    for (const f of ['frame.exr', 'plate.dpx', 'ref.jpg', 'thumb.PNG', 'matte.tga', 'scan.tiff']) {
      expect(inferMediaKind(f)).toBe(MediaKind.IMAGE);
    }
  });

  it('reconnaît les échanges 3D', () => {
    for (const f of ['hero.glb', 'set.usd', 'char.fbx']) {
      expect(inferMediaKind(f)).toBe(MediaKind.MODEL_3D);
    }
  });

  /**
   * `.abc` était annoncé en MODEL_3D alors que `detect3D` ne le reconnaît pas et qu'aucun
   * convertisseur ne sait en tirer un GLB : l'envoi était accepté puis refusé une fois le
   * cache Alembic entièrement transféré. Retiré tant que la chaîne ne le prend pas.
   */
  it('nʼannonce plus Alembic, que rien ne sait lire', () => {
    expect(() => inferMediaKind('cache.abc')).toThrow(/cannot tell the media kind/i);
  });

  it('reconnaît les splats gaussiens', () => {
    for (const f of ['scan.splat', 'capture.ply', 'scene.spz']) {
      expect(inferMediaKind(f)).toBe(MediaKind.SPLAT);
    }
  });

  // Tout ce que `detectSplat` accepte à la validation d'en-tête doit être devinable ici :
  // sans quoi un envoi DCC sans `kind` explicite est refusé (KIND_UNKNOWN) alors que le
  // viewer sait afficher le fichier.
  it('reconnaît les conteneurs splat sans magic bytes (KSPLAT, SOG, SOGS)', () => {
    for (const f of ['scan.ksplat', 'capture.sog', 'capture.sogs', 'CAPTURE.SOGS']) {
      expect(inferMediaKind(f)).toBe(MediaKind.SPLAT);
    }
  });

  it('refuse explicitement plutôt que de deviner au hasard', () => {
    expect(() => inferMediaKind('notes.txt')).toThrow(/cannot tell the media kind/i);
    expect(() => inferMediaKind('sansextension')).toThrow(/cannot tell the media kind/i);
  });
});
