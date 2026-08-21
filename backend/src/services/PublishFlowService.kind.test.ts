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

  it('reconnaît les images, séquences comprises', () => {
    for (const f of ['frame.exr', 'plate.dpx', 'ref.jpg', 'thumb.PNG']) {
      expect(inferMediaKind(f)).toBe(MediaKind.IMAGE);
    }
  });

  it('reconnaît les échanges 3D', () => {
    for (const f of ['hero.glb', 'set.usd', 'char.fbx', 'cache.abc']) {
      expect(inferMediaKind(f)).toBe(MediaKind.MODEL_3D);
    }
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
