// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What a guest receives to open a media.
 *
 * The public page declared fourteen fields and the route only served three: the guest viewer fell back to
 * blind default values. Two of them show up as soon as the client is allowed to annotate: `fps` and
 * `startFrame` anchor the annotation to a frame, and a wrong frame is a number the artist cannot find again.
 */

const { db, hdri } = vi.hoisted(() => ({
  db: { project: { findUnique: vi.fn() } },
  hdri: { findWithUrl: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/${key}?sig`)) },
}));
vi.mock('./MediaService', () => ({
  mediaViewKey: vi.fn((media: { storageKey: string }) => media.storageKey),
}));
vi.mock('./HdriService', () => hdri);
vi.mock('../lib/projectSettings', () => ({
  resolveProjectSettingsById: vi.fn(() => Promise.resolve({ defaultLighting: { exposure: 1 } })),
}));
// The ratio inheritance chain has its own bench (`lib/deliveryAspect`); here we only check that the guest
// receives it, otherwise their frame falls back to an arbitrary 16:9.
vi.mock('../lib/deliveryAspect', () => ({ resolveDeliveryAspect: vi.fn(() => Promise.resolve(2.39)) }));

import type { MediaObject } from '@prisma/client';
import { buildClientMediaSource } from './ClientMediaSourceService';
import { resolveDeliveryAspect } from '../lib/deliveryAspect';

const VERSION = 77;

const mediaOf = (metadata: Record<string, unknown>): MediaObject =>
  ({
    id: 128,
    versionId: VERSION,
    storageKey: 'review/projects/p/SH0100/V01/128/plate.fbx',
    metadata,
  }) as unknown as MediaObject;

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findUnique.mockResolvedValue({ startFrame: 1001 });
  hdri.findWithUrl.mockResolvedValue(null);
});

describe('buildClientMediaSource: what is needed to open a media for a guest', () => {
  it('serves the GLB derivative of a converted model, presigned like the rest', async () => {
    const source = await buildClientMediaSource(mediaOf({ glbKey: 'derived/128/model.glb' }), 42);
    expect(source.url).toBe('https://minio/review/projects/p/SH0100/V01/128/plate.fbx?sig');
    expect(source.glbUrl).toBe('https://minio/derived/128/model.glb?sig');
  });

  it('returns glbUrl as null when the media has no derivative', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.glbUrl).toBeNull();
    expect(source.slateSec).toBe(0);
  });

  it('lets the video serve its client derivative, slate included', async () => {
    const source = await buildClientMediaSource(
      mediaOf({ clientProxyKey: 'derived/128/client.mp4', slateSec: 3 }),
      42,
    );
    expect(source.url).toBe('https://minio/derived/128/client.mp4?sig');
    expect(source.slateSec).toBe(3);
    expect(source.glbUrl).toBeNull();
  });

  // The slate belongs only to the derivative: announcing it without the derivative would shift every
  // timestamp.
  it('ignores a slate declared without a client derivative', async () => {
    expect((await buildClientMediaSource(mediaOf({ slateSec: 3 }), 42)).slateSec).toBe(0);
  });

  /**
   * The heart of the batch: a video annotation is anchored to a frame. Without the real frame rate, the guest
   * viewer falls back to 24 fps and drifts by one frame per second on a 23.976 clip.
   */
  it('carries the project frame rate and first frame', async () => {
    db.project.findUnique.mockResolvedValue({ startFrame: 1 });
    const source = await buildClientMediaSource(mediaOf({ fps: 23.976 }), 42);
    expect(source.fps).toBe(23.976);
    expect(source.startFrame).toBe(1);
  });

  it('falls back to the conventional first frame when the project does not declare one', async () => {
    db.project.findUnique.mockResolvedValue(null);
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.startFrame).toBe(1001);
    expect(source.fps).toBeNull();
  });

  it('replays the splat staging: edits, mask, ops and presentation', async () => {
    const source = await buildClientMediaSource(
      mediaOf({
        splatEdits: { flip: true },
        splatMaskKey: 'derived/128/mask.bin',
        splatSubsetKey: 'derived/128/ops.bin',
        splatPresentation: { camera: { aspect: 2.39 } },
      }),
      42,
    );
    expect(source.splatEdits).toEqual({ flip: true });
    expect(source.splatMaskUrl).toBe('https://minio/derived/128/mask.bin?sig');
    expect(source.splatSubsetUrl).toBe('https://minio/derived/128/ops.bin?sig');
    expect(source.splatPresentation).toEqual({ camera: { aspect: 2.39 } });
  });

  /**
   * The delivery frame ratio, inherited from the pipeline settings of the version's shot. Without it, a
   * spatial media without staging opens for the guest in an arbitrary 16:9, whereas the delivered project may
   * be in scope, and the guest would annotate a frame that is not the right one.
   */
  it('carries the inherited delivery ratio, resolved for the shot of ITS version', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.deliveryAspect).toBeCloseTo(2.39);
    expect(vi.mocked(resolveDeliveryAspect)).toHaveBeenCalledWith(VERSION, 42);
  });

  // Without the prim paths, the USD override indexes nothing and the scene opens as the GLB was baked: a
  // correct fallback, not the supervisor's staging.
  it('returns the prim paths and variants that index the USD override', async () => {
    const source = await buildClientMediaSource(
      mediaOf({
        usdOverride: { hidden: ['/root/sphere'] },
        model: {
          usd: { prims: [{ path: '/root' }, { path: '/root/sphere' }], variantSets: [{ prim: '/root' }] },
        },
      }),
      42,
    );
    expect(source.usdPrimPaths).toEqual(['/root', '/root/sphere']);
    expect(source.usdVariantSets).toEqual([{ prim: '/root' }]);
    expect(source.usdOverride).toEqual({ hidden: ['/root/sphere'] });
  });

  it('leaves the USD fields null when the media is not a USD scene', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.usdPrimPaths).toBeNull();
    expect(source.usdVariantSets).toBeNull();
  });

  /**
   * The connected viewer queries `/api/studio/hdris`, an authenticated route: without resolution here, a
   * media staged under an HDRI opens with neutral lighting.
   */
  it('resolves the presentation HDRI to a URL, and nothing else', async () => {
    hdri.findWithUrl.mockResolvedValue({ url: 'https://minio/studio/hdris/x.hdr?sig', format: 'hdr' });
    const source = await buildClientMediaSource(
      mediaOf({ splatPresentation: { lighting: { hdriId: 'abc' } } }),
      42,
    );
    expect(hdri.findWithUrl).toHaveBeenCalledWith('abc');
    expect(source.hdri).toEqual({ url: 'https://minio/studio/hdris/x.hdr?sig', format: 'hdr' });
  });

  it('does not query the HDRI library when the presentation cites none', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(hdri.findWithUrl).not.toHaveBeenCalled();
    expect(source.hdri).toBeNull();
  });

  // An HDRI removed from the library must not break opening the media.
  it('tolerates an HDRI that has disappeared from the library', async () => {
    const source = await buildClientMediaSource(
      mediaOf({ splatPresentation: { lighting: { hdriId: 'gone' } } }),
      42,
    );
    expect(source.hdri).toBeNull();
  });

  it('carries the project default lighting, a fallback for media without their own', async () => {
    const source = await buildClientMediaSource(mediaOf({}), 42);
    expect(source.projectDefaultLighting).toEqual({ exposure: 1 });
  });
});
