// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  MAX_ANNOTATION_BYTES,
  MAX_POI_POINTS,
  annotationSchema,
  cameraStateSchema,
  guestAnnotationSchema,
  parseAnnotation,
  parseCameraState,
  parseGuestAnnotation,
} from './commentPayload';

/**
 * A2-04: `annotation` and `cameraState` were `z.any()`. These cases state both halves of the
 * contract: what the viewer really sends must pass intact, and anything beyond it (free field,
 * oversized string, volume) must be refused on write.
 */

describe('annotationSchema — what the viewer sends passes', () => {
  it('accepts the 2D shapes of the overlay', () => {
    const shapes = [
      {
        id: 'a1',
        type: 'path',
        color: '#ef4444',
        width: 3,
        alpha: 1,
        pts: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      },
      { id: 'a2', type: 'rect', color: '#22d3ee', width: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
      { id: 'a3', type: 'arrow', color: 'red', width: 2, x1: 0, y1: 0, x2: 0.5, y2: 0.5 },
      { id: 'a4', type: 'text', color: '#facc15', width: 4, x: 0.2, y: 0.2, text: 'raccord' },
    ];
    expect(annotationSchema.safeParse(shapes).success).toBe(true);
  });

  it('accepts the 3D hotspot, a painter stroke, a video range and a camera animation', () => {
    const parts = [
      { type: 'hotspot', position: '1,2,3', normal: '0,1,0', space: 'object' },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#ffffff', width: 2 },
      { type: 'range', inFrame: 24, outFrame: 48 },
      {
        type: 'camera-anim',
        version: 2,
        loop: true,
        channels: { px: { keys: [{ t: 0, v: 1, mode: 'auto' }] } },
      },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
  });

  it('accepts a camera animation with separate, weighted and cyclic tangents', () => {
    // The attached animation schema is STRICT: a key field forgotten here would not be silently
    // stripped, it would make the comment submission fail.
    const parts = [
      {
        type: 'camera-anim',
        version: 2,
        loop: false,
        channels: {
          px: {
            keys: [
              { t: 0, v: 1, mode: 'free', modeIn: 'flat', modeOut: 'free', tin: 0, tout: 0.2 },
              { t: 500, v: 2, mode: 'free', broken: true, tin: 0.1, tout: 0.3, wIn: 1, wOut: 1.5 },
            ],
            pre: 'constant',
            post: 'cycleOffset',
          },
        },
      },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
  });

  it('keeps the pose base of the attached animation', () => {
    // The part is STRICT: a base missing from the shared schema would make the comment submission
    // fail. Silently stripped, it would replay the unkeyed channels on every viewer's view — the target
    // would jump back to the world origin for the reviewer.
    const base = { position: { x: 9, y: 3, z: 4 }, target: { x: 1, y: 0.5, z: -2 }, fov: 50 };
    const part = {
      type: 'camera-anim',
      version: 2,
      loop: true,
      base,
      channels: {
        px: {
          keys: [
            { t: 0, v: 0, mode: 'auto' },
            { t: 1_000, v: 10, mode: 'auto' },
          ],
        },
      },
    };
    const [parsed] = annotationSchema.parse([part]) as [typeof part];
    expect(parsed.base).toEqual(base);
    // An animation without a base is still accepted: comments already sent have none.
    const { base: _sansBase, ...nu } = part;
    expect(annotationSchema.safeParse([nu]).success).toBe(true);
  });

  it('keeps the playback duration of the attached animation', () => {
    // Playback must be identical: `durationMs` fixes the loop end, and without it the received
    // animation would loop on its last keyframe time. The front end left it on the dock; this case
    // checks that it survives the write without being silently stripped.
    const part = {
      type: 'camera-anim',
      version: 2,
      loop: true,
      durationMs: 4_000,
      channels: {
        px: {
          keys: [
            { t: 0, v: 0, mode: 'auto' },
            { t: 2_000, v: 10, mode: 'auto' },
          ],
        },
      },
    };
    const [parsed] = annotationSchema.parse([part]) as [typeof part];
    expect(parsed.durationMs).toBe(4_000);
    expect(parsed.channels.px.keys).toHaveLength(2);
  });

  it('accepts a 3D staging proposal (46.D)', () => {
    const parts = [
      {
        type: 'scene-override',
        override: { version: 1, prims: { '/root/geo': { visible: false } } },
      },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
  });
});

describe('annotationSchema — what overflows is refused', () => {
  it('refuses a free object instead of the list of parts', () => {
    expect(annotationSchema.safeParse({ pad: 'A'.repeat(1_000) }).success).toBe(false);
  });

  it('refuses a part of unknown type', () => {
    expect(annotationSchema.safeParse([{ type: 'whatever', pad: 'A' }]).success).toBe(false);
  });

  it('refuses a free key slipped into a known shape', () => {
    expect(
      annotationSchema.safeParse([{ type: 'rect', x: 0, y: 0, w: 1, h: 1, pad: 'A'.repeat(100_000) }])
        .success,
    ).toBe(false);
  });

  it('refuses a colour that is not one (barrier in front of the SVG rendering)', () => {
    expect(annotationSchema.safeParse([{ type: 'rect', color: '#fff" onload="x' }]).success).toBe(false);
    expect(annotationSchema.safeParse([{ type: 'rect', color: 'url(#x)' }]).success).toBe(false);
  });

  it('refuses an oversized annotation text', () => {
    expect(annotationSchema.safeParse([{ type: 'text', text: 'A'.repeat(50_000) }]).success).toBe(false);
  });

  it('refuses a stroke of more than four thousand points', () => {
    const pts = Array.from({ length: 5_000 }, () => [0.5, 0.5]);
    expect(annotationSchema.safeParse([{ type: 'path', pts }]).success).toBe(false);
  });

  it('refuses a total volume beyond the ceiling, even with valid parts', () => {
    // Perfectly legal strokes, but numerous enough to weigh more than the ceiling.
    const stroke = {
      type: 'splat-paint',
      points: Array.from({ length: 12_000 }, (_, i) => i / 1_000),
      color: '#ffffff',
      width: 2,
    };
    const parts = Array.from({ length: 20 }, () => stroke);
    expect(JSON.stringify(parts).length).toBeGreaterThan(MAX_ANNOTATION_BYTES);
    expect(annotationSchema.safeParse(parts).success).toBe(false);
  });

  it('refuses a non-finite number (NaN/Infinity arrive in JSON as null or as a string)', () => {
    expect(annotationSchema.safeParse([{ type: 'rect', x: 1e12 }]).success).toBe(false);
  });
});

describe('cameraStateSchema', () => {
  it('accepts the pose captured by the 3D viewer, view state included', () => {
    const pose = {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      fov: 45,
      aspect: 1.778,
      roll: 0.1,
      view: {
        display: 'wireframe',
        section: { active: true, axis: 'x', position: 0.2, flip: false },
        lighting: {
          hdriId: 'studio',
          exposure: 1,
          rotationDeg: 0,
          showBackground: false,
          groundShadow: true,
        },
      },
    };
    expect(cameraStateSchema.safeParse(pose).success).toBe(true);
  });

  it('accepts the Spark depth of field attached to the pose', () => {
    const pose = {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      apertureAngle: 0.01,
      focalDistance: 5,
    };
    expect(cameraStateSchema.safeParse(pose).success).toBe(true);
  });

  it('refuses a blob without a pose', () => {
    expect(cameraStateSchema.safeParse({ p: 'A'.repeat(1_000) }).success).toBe(false);
  });

  it('refuses a payload hidden in an unknown field', () => {
    expect(
      cameraStateSchema.safeParse({
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        pad: 'A'.repeat(1_900_000),
      }).success,
    ).toBe(false);
  });

  it('refuses an aberrant focal length', () => {
    expect(
      cameraStateSchema.safeParse({
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        fov: 1e9,
      }).success,
    ).toBe(false);
  });
});

describe('parseAnnotation / parseCameraState — re-read on write', () => {
  it('let an absent value through', () => {
    expect(parseAnnotation(undefined)).toBeUndefined();
    expect(parseAnnotation(null)).toBeUndefined();
    expect(parseCameraState(undefined)).toBeUndefined();
    expect(parseCameraState(null)).toBeUndefined();
  });

  it('throw a 400 rather than a 500 when the value does not fit', () => {
    expect(() => parseAnnotation({ pad: 'A' })).toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() => parseCameraState({ pad: 'A' })).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it('return the value re-read, stripped of what is not in the contract', () => {
    const parts = [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }];
    expect(parseAnnotation(parts)).toEqual(parts);
  });
});

/**
 * The annotation of a GUEST is narrower than a member's, on purpose.
 *
 * A client draws on the image and places a point on a surface: these are remarks. The three parts
 * removed are author gestures, replayed to ALL viewers of the media — a 3D staging proposal, a camera
 * animation, painter strokes. Accepting them would let an anonymous user holding a URL write into what
 * other people see.
 */
describe('guestAnnotationSchema — what a share link is allowed to write', () => {
  const rect = { type: 'rect', id: 'a', color: '#ef4444', width: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

  it('accepts a drawing and a surface point', () => {
    expect(guestAnnotationSchema.safeParse([rect]).success).toBe(true);
    expect(
      guestAnnotationSchema.safeParse([{ type: 'hotspot', position: '1,2,3', normal: '0,1,0' }]).success,
    ).toBe(true);
  });

  it('refuses the author parts that a member schema accepts', () => {
    const authored = [
      [{ type: 'scene-override', override: null }],
      [{ type: 'splat-paint', points: [0, 0, 0], color: '#ffffff', width: 1 }],
      [{ type: 'camera-anim', version: 2, loop: false, channels: {} }],
    ];
    for (const parts of authored) {
      // The member is allowed: it is the guest that is restricted, not the shape.
      expect(annotationSchema.safeParse(parts).success).toBe(true);
      expect(guestAnnotationSchema.safeParse(parts).success).toBe(false);
    }
  });

  it('bounds the volume more tightly than for a member', () => {
    expect(guestAnnotationSchema.safeParse(Array.from({ length: 60 }, () => rect)).success).toBe(true);
    expect(guestAnnotationSchema.safeParse(Array.from({ length: 61 }, () => rect)).success).toBe(false);
    // A single field is enough to make a large blob: the byte ceiling closes the door.
    const fat = { type: 'text', x: 0, y: 0, text: 'x'.repeat(2_000) };
    expect(guestAnnotationSchema.safeParse(Array.from({ length: 40 }, () => fat)).success).toBe(false);
  });

  it('re-reads on write like its internal equivalent', () => {
    expect(parseGuestAnnotation(undefined)).toBeUndefined();
    expect(parseGuestAnnotation(null)).toBeUndefined();
    expect(parseGuestAnnotation([rect])).toEqual([rect]);
    expect(() =>
      parseGuestAnnotation([{ type: 'splat-paint', points: [], color: '#fff', width: 1 }]),
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('poiPart — a carrying comment, numbered points', () => {
  const point = { position: '1 2 3', normal: '0 1 0', space: 'object' as const };

  it('accepts a single part carrying several points, with text and images', () => {
    const parts = [
      {
        type: 'poi',
        points: [
          { ...point, text: 'la soudure', images: ['comments/attachments/3/a.png'] },
          { position: '4 5 6', normal: '0 0 1' },
        ],
      },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
    expect(parseAnnotation(parts)).toEqual(parts);
  });

  it('requires at least one point, and does not accept more than the ceiling', () => {
    expect(annotationSchema.safeParse([{ type: 'poi', points: [] }]).success).toBe(false);
    const many = (n: number) => [{ type: 'poi', points: Array.from({ length: n }, () => point) }];
    expect(annotationSchema.safeParse(many(MAX_POI_POINTS)).success).toBe(true);
    expect(annotationSchema.safeParse(many(MAX_POI_POINTS + 1)).success).toBe(false);
  });

  it('bounds each field and refuses any free key', () => {
    const over = [{ type: 'poi', points: [{ ...point, text: 'x'.repeat(2_001) }] }];
    expect(annotationSchema.safeParse(over).success).toBe(false);
    const extra = [{ type: 'poi', points: [{ ...point, author: 'moi' }] }];
    expect(annotationSchema.safeParse(extra).success).toBe(false);
    const images = [{ type: 'poi', points: [{ ...point, images: Array.from({ length: 9 }, () => 'k') }] }];
    expect(annotationSchema.safeParse(images).success).toBe(false);
  });

  it('remains refused to a guest: a share link only places a hotspot', () => {
    const parts = [{ type: 'poi', points: [point] }];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
    expect(guestAnnotationSchema.safeParse(parts).success).toBe(false);
  });

  it('coexists with the other parts of the same comment', () => {
    const parts = [
      { type: 'poi', points: [point] },
      { type: 'splat-paint', points: [0, 0, 0], color: '#ffffff', width: 2 },
      { type: 'rect', x: 0, y: 0, w: 0.1, h: 0.1 },
    ];
    expect(annotationSchema.safeParse(parts).success).toBe(true);
  });
});

describe('splatEditPart — a cloud edit proposed in a comment', () => {
  const trs = {
    position: [1, 0, -2] as [number, number, number],
    quaternion: [0, 0.7071, 0, 0.7071] as [number, number, number, number],
    scale: [1.5, 1.5, 1.5] as [number, number, number],
  };
  const volume = { shape: 'box', mode: 'delete', ...trs };
  const part = (over: Record<string, unknown> = {}) => [
    { type: 'splat-edit', transform: trs, volumes: [volume], ...over },
  ];

  it('accepts the transform, the volumes and the orientation flip', () => {
    expect(annotationSchema.safeParse(part()).success).toBe(true);
    expect(annotationSchema.safeParse(part({ baseFlip: false })).success).toBe(true);
    expect(annotationSchema.safeParse(part({ transform: null, volumes: [] })).success).toBe(true);
  });

  /**
   * Deletions travel, and they are the heart of this batch: the most common gesture on a cloud is to
   * clean it up. They travel by REFERENCE — the part carries the key of an attachment of the comment,
   * never the binary, which would not fit in an annotation.
   */
  it('accepts references to both binaries (mask, subset ops)', () => {
    const refs = { mask: { key: 'comments/attachments/1/splat-mask.bin', count: 3 } };
    expect(annotationSchema.safeParse(part(refs)).success).toBe(true);
    const both = {
      mask: { key: 'comments/attachments/1/splat-mask.bin', count: 3 },
      subset: { key: 'comments/attachments/1/splat-subset.bin', count: 1 },
    };
    expect(annotationSchema.safeParse(part(both)).success).toBe(true);
    // A cleanup with only the mask: nothing moves, and the proposal still exists.
    expect(annotationSchema.safeParse(part({ ...both, transform: null, volumes: [] })).success).toBe(true);
  });

  /**
   * The reference stays BOUNDED and the binary stays out: the blob itself, a key without an account,
   * an account without a key, or a free field slipped into the part must be refused by the schema —
   * not merely omitted by the client.
   */
  it('refuses the binary itself, an incomplete reference, a free field', () => {
    for (const extra of [
      { mask: 'AAAA' },
      { mask: { key: 'comments/attachments/1/splat-mask.bin' } },
      { mask: { count: 3 } },
      { mask: { key: 'k', count: 3, data: 'AAAA' } },
      { splatMaskKey: 'comments/attachments/1/mask.bin' },
      { subsetOps: 'AAAA' },
      { deleted: [1, 2, 3] },
    ]) {
      expect(annotationSchema.safeParse(part(extra)).success).toBe(false);
    }
  });

  it('refuses a proposal out of bounds: too many volumes, zero scale, incomplete TRS', () => {
    const many = part({ volumes: Array.from({ length: 33 }, () => volume) });
    expect(annotationSchema.safeParse(many).success).toBe(false);
    const flat = part({ transform: { ...trs, scale: [0, 1, 1] } });
    expect(annotationSchema.safeParse(flat).success).toBe(false);
    const short = part({ transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1] } });
    expect(annotationSchema.safeParse(short).success).toBe(false);
    const far = part({ transform: { ...trs, position: [1e9, 0, 0] } });
    expect(annotationSchema.safeParse(far).success).toBe(false);
  });

  it('remains refused to a guest: it is an author gesture, not a remark', () => {
    expect(guestAnnotationSchema.safeParse(part()).success).toBe(false);
  });

  it('goes through parseAnnotation, like any part written outside a route', () => {
    expect(parseAnnotation(part())).toEqual(part());
  });
});
