// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { MediaKind } from '@prisma/client';

// The service pulls in the whole media pipeline (storage, queues): here we only test the type deduction, a
// pure function, by neutralising the side-effecting modules.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./MediaService', () => ({}));
vi.mock('./PipelineEnsureService', () => ({}));
vi.mock('./PipelineResolveService', () => ({}));
vi.mock('./VersionService', () => ({}));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));

import { inferMediaKind } from './PublishFlowService';

describe('inferMediaKind', () => {
  it('recognises production video containers', () => {
    for (const f of ['shot.mov', 'playblast.mp4', 'master.mxf', 'take.webm']) {
      expect(inferMediaKind(f)).toBe(MediaKind.VIDEO);
    }
  });

  it('recognises images, production formats included', () => {
    for (const f of ['frame.exr', 'plate.dpx', 'ref.jpg', 'thumb.PNG', 'matte.tga', 'scan.tiff']) {
      expect(inferMediaKind(f)).toBe(MediaKind.IMAGE);
    }
  });

  it('recognises 3D exchange formats', () => {
    for (const f of ['hero.glb', 'set.usd', 'char.fbx']) {
      expect(inferMediaKind(f)).toBe(MediaKind.MODEL_3D);
    }
  });

  /**
   * `.abc` was announced as MODEL_3D although `detect3D` does not recognise it and no converter can derive a
   * GLB from it: the upload was accepted, then refused once the Alembic
   * cache had been entirely transferred. Removed until the chain takes it.
   */
  it('no longer announces Alembic, which nothing can read', () => {
    expect(() => inferMediaKind('cache.abc')).toThrow(/cannot tell the media kind/i);
  });

  it('recognises Gaussian splats', () => {
    for (const f of ['scan.splat', 'capture.ply', 'scene.spz']) {
      expect(inferMediaKind(f)).toBe(MediaKind.SPLAT);
    }
  });

  // Everything that `detectSplat` accepts at header validation must be guessable here: otherwise a DCC upload
  // without an explicit `kind` is refused (KIND_UNKNOWN) although the viewer can display the file.
  it('recognises splat containers without magic bytes (KSPLAT, SOG, SOGS)', () => {
    for (const f of ['scan.ksplat', 'capture.sog', 'capture.sogs', 'CAPTURE.SOGS']) {
      expect(inferMediaKind(f)).toBe(MediaKind.SPLAT);
    }
  });

  it('refuses explicitly rather than guessing at random', () => {
    expect(() => inferMediaKind('notes.txt')).toThrow(/cannot tell the media kind/i);
    expect(() => inferMediaKind('sansextension')).toThrow(/cannot tell the media kind/i);
  });
});
