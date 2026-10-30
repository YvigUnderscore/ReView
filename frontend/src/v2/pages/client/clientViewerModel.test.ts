// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  clientFrameAspect,
  clientLighting,
  clientVariantDefaults,
  mediaTimeOf,
  playerTimeOf,
  resolveClientGlb,
  resolveClientSplat,
  toPlayerComments,
} from './clientViewerModel';
import { DEFAULT_LIGHTING } from '../review/reviewTypes';
import type { ClientMediaSource } from './clientTypes';
import type { ClientComment } from '../../types/api';

const source = (patch: Partial<ClientMediaSource> = {}): ClientMediaSource => ({
  url: 'https://minio.example/bucket/media.mp4?X-Amz-Signature=abc',
  ...patch,
});

/**
 * This batch decides what a guest can see with what the share route gives them. The verified
 * cases are those that make the difference between "the 3D shows" and "the client gets a
 * black square": missing derivative, extension carried by the name rather than the URL, old
 * presentation, and the slate offset that shifts every comment.
 */
describe('resolveClientGlb', () => {
  it('prefers the converted GLB when the share exposes it', () => {
    expect(resolveClientGlb(source({ url: 'x/a.usdz', glbUrl: 'x/a.glb?sig' }))).toBe('x/a.glb?sig');
  });

  it('accepts the source when it is already glTF, signature included', () => {
    expect(resolveClientGlb(source({ url: 'https://s3/a.glb?X-Amz-Signature=z' }))).toContain('.glb');
    expect(resolveClientGlb(source({ url: 'https://s3/a.gltf' }))).toContain('.gltf');
  });

  it('refuses a non-convertible original rather than loading an unreadable file', () => {
    expect(resolveClientGlb(source({ url: 'https://s3/scene.usda?sig' }))).toBeNull();
    expect(resolveClientGlb(source({ url: 'https://s3/mesh.fbx' }))).toBeNull();
    expect(resolveClientGlb(undefined)).toBeNull();
  });
});

describe('resolveClientSplat', () => {
  it('takes the extension from the original name, since the presigned URL carries a query', () => {
    const file = resolveClientSplat(source({ url: 'https://s3/obj?X-Amz-Signature=1' }), 'scan.spz');
    expect(file).toEqual({ url: 'https://s3/obj?X-Amz-Signature=1', fileName: 'scan.spz' });
  });

  it('falls back to the cleaned URL when the original name is not informative', () => {
    const file = resolveClientSplat(source({ url: 'https://s3/scan.ply?sig=1' }), 'version-020');
    expect(file?.fileName).toBe('https://s3/scan.ply');
  });

  it('refuses a file that Spark cannot open', () => {
    expect(resolveClientSplat(source({ url: 'https://s3/a.mp4' }), 'a.mp4')).toBeNull();
  });

  it('accepts the SOG containers in both spellings', () => {
    expect(resolveClientSplat(source(), 'scan.sog')?.fileName).toBe('scan.sog');
    expect(resolveClientSplat(source(), 'scan.sogs')?.fileName).toBe('scan.sogs');
  });
});

/**
 * Deliberately rewritten: the function returned `undefined` as soon as no presentation froze
 * an aspect, and each caller copied its own 16/9 fallback. It now returns the inherited
 * delivery ratio the route serves: the guest annotates the project's frame, not a 16/9.
 */
describe('clientFrameAspect', () => {
  it('replays the recorded delivery frame aspect', () => {
    const s = source({ splatPresentation: { camera: { position: p(), target: p(), aspect: 2.39 } } });
    expect(clientFrameAspect(s)).toBeCloseTo(2.39);
  });

  it('takes the ratio inherited from pipeline settings when nothing is frozen', () => {
    expect(clientFrameAspect(source({ deliveryAspect: 2.39 }))).toBeCloseTo(2.39);
  });

  it('ignores a degenerate aspect rather than producing a zero-height frame', () => {
    const s = source({
      splatPresentation: { camera: { position: p(), target: p(), aspect: 0 } },
      deliveryAspect: 1.85,
    });
    expect(clientFrameAspect(s)).toBeCloseTo(1.85);
    expect(clientFrameAspect(source())).toBeCloseTo(16 / 9);
  });
});

describe('clientLighting', () => {
  it('prefers the media setting over the project default', () => {
    const s = source({
      splatPresentation: { lighting: { ...DEFAULT_LIGHTING, exposure: 2 } },
      projectDefaultLighting: { ...DEFAULT_LIGHTING, exposure: 5 },
    });
    expect(clientLighting(s).exposure).toBe(2);
  });

  it('falls back to the project default, then to neutral lighting', () => {
    const s = source({ projectDefaultLighting: { ...DEFAULT_LIGHTING, rotationDeg: 90 } });
    expect(clientLighting(s).rotationDeg).toBe(90);
    expect(clientLighting(source())).toEqual(DEFAULT_LIGHTING);
  });

  it('completes an old record where a field is missing', () => {
    const partial = { exposure: 3 } as unknown as ClientMediaSource['projectDefaultLighting'];
    expect(clientLighting(source({ projectDefaultLighting: partial }))).toEqual({
      ...DEFAULT_LIGHTING,
      exposure: 3,
    });
  });
});

describe('clientVariantDefaults', () => {
  it('groups the variant sets active at conversion by prim', () => {
    expect(
      clientVariantDefaults([
        { prim: '/World/Plate', name: 'modelingVariant', options: ['a', 'b'], selected: 'a' },
        { prim: '/World/Plate', name: 'shadingVariant', options: ['clean'], selected: 'clean' },
      ]),
    ).toEqual({ '/World/Plate': { modelingVariant: 'a', shadingVariant: 'clean' } });
  });

  it('assumes nothing when the scene is not described', () => {
    expect(clientVariantDefaults(null)).toEqual({});
  });
});

describe('slate offset', () => {
  it('removes the slate on submit and restores it on seek: neutral round trip', () => {
    expect(mediaTimeOf(8, 3)).toBe(5);
    expect(playerTimeOf(mediaTimeOf(8, 3), 3)).toBe(8);
  });

  it('never produces a negative position during the slate itself', () => {
    expect(mediaTimeOf(1.2, 3)).toBe(0);
  });

  it('moves the timeline markers into the player frame of reference', () => {
    const mapped = toPlayerComments(
      [
        note({ id: 1, timestamp: 5, guestName: 'Cli' }),
        note({ id: 2, timestamp: null, guestName: null, author: { id: 7, name: 'Sup' } }),
      ],
      3,
    );
    expect(mapped[0].timestamp).toBe(8);
    expect(mapped[1].timestamp).toBeNull();
    expect(mapped[1].author).toEqual({ id: 7, name: 'Sup' });
  });

  it('leaves timestamps intact when the derivative has no slate', () => {
    expect(toPlayerComments([note({ timestamp: 12 })], 0)[0].timestamp).toBe(12);
  });

  /**
   * The drawing did arrive from the server and the front end discarded it: an annotated note
   * therefore displayed without its stroke, and the client never saw what the studio showed.
   */
  it('now carries the annotation instead of discarding it', () => {
    const shapes = [{ id: 'a', type: 'rect', color: '#ef4444', width: 3 }];
    expect(toPlayerComments([note({ annotation: shapes })], 0)[0].annotation).toEqual(shapes);
    expect(toPlayerComments([note()], 0)[0].annotation).toBeNull();
  });
});

/** A share note, reduced to what the timeline reads from it. */
function note(patch: Partial<ClientComment> = {}): ClientComment {
  return {
    id: 1,
    content: 'a',
    timestamp: null,
    duration: null,
    guestName: null,
    author: null,
    createdAt: 'x',
    isEdited: false,
    annotation: null,
    ...patch,
  };
}

/** Minimal camera pose: only `aspect` matters to the frame tests. */
function p() {
  return { x: 0, y: 0, z: 0 };
}
