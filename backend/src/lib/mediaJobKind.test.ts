// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { jobKindFor, spatialThumbSource } from './mediaJobKind';

describe('jobKindFor', () => {
  it('routes each media family to its job on the media queue', () => {
    expect(jobKindFor(MediaKind.VIDEO, '.mp4')).toBe('transcode');
    expect(jobKindFor(MediaKind.IMAGE, '.png')).toBe('thumbnail');
    expect(jobKindFor(MediaKind.MODEL_3D, '.usdz')).toBe('convert3d');
  });

  it('triggers no media job for what is served as-is', () => {
    // The native GLB and the splats have nothing to convert: they become READY immediately.
    expect(jobKindFor(MediaKind.MODEL_3D, '.glb')).toBeNull();
    expect(jobKindFor(MediaKind.SPLAT, '.ply')).toBeNull();
  });
});

describe('spatialThumbSource', () => {
  it('claims a Blender render for any 3D media, converted or native', () => {
    expect(spatialThumbSource(MediaKind.MODEL_3D, '.glb')).toBe('model');
    expect(spatialThumbSource(MediaKind.MODEL_3D, '.fbx')).toBe('model');
    expect(spatialThumbSource(MediaKind.MODEL_3D, '.usdz')).toBe('model');
  });

  it('claims the rasteriser for the splat containers we know how to read', () => {
    expect(spatialThumbSource(MediaKind.SPLAT, '.ply')).toBe('splat');
    expect(spatialThumbSource(MediaKind.SPLAT, '.SPLAT')).toBe('splat');
  });

  it('enqueues nothing for a compressed container we cannot read', () => {
    // Better no thumbnail than a job that fails in a loop: .spz/.ksplat/.sog are covered by the client capture on
    // first display.
    expect(spatialThumbSource(MediaKind.SPLAT, '.spz')).toBeNull();
    expect(spatialThumbSource(MediaKind.SPLAT, '.ksplat')).toBeNull();
    expect(spatialThumbSource(MediaKind.SPLAT, '.sog')).toBeNull();
  });

  it('ignores video and image, which already have their thumbnail', () => {
    expect(spatialThumbSource(MediaKind.VIDEO, '.mp4')).toBeNull();
    expect(spatialThumbSource(MediaKind.IMAGE, '.jpg')).toBeNull();
  });
});
