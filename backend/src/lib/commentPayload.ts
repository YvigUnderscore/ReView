// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { cameraAnimShape, channelSchema, curveKeySchema } from './cameraAnimSchema';
import { badRequest } from './errors';
import { MAX_COMMENT_ATTACHMENTS } from './commentAttachments';
import { splatEditBlobRef } from './commentSplatEdit';
import { sceneOverrideSchema } from './sceneOverride';

/**
 * Shape and volume of the two JSON blobs of a review comment: `annotation` and `cameraState`.
 *
 * These two columns were declared `z.any()` in the routes. The effective ceiling was therefore the body
 * parser's (2 MB): any account — and, on the public share route, any guest holding the link — could
 * write megabyte after megabyte of arbitrary JSON into the `Comment` table, then have it rebroadcast as
 * is to every socket of the project. Validation lives here, as close to the write as possible, so that
 * non-route callers (`CommentService.createGuest`) are covered too.
 *
 * Two principles:
 *  - **Writing is strict, reading stays tolerant.** Annotations already in the database never go back
 *    through these schemas: `annotationSvg.parseShapes` and `splitAnnotationParts` keep reading what is
 *    there. Nothing existing breaks; the door is closed for the future.
 *  - **Every string is bounded**, down to the colour name: this makes it impossible to fill a single
 *    field with 1.9 MB of text, regardless of the global ceiling.
 */

const finite = z.number().finite();

/** 2D annotation coordinate: normalised 0..1, but a shape may overflow the frame. */
const norm = finite.min(-1_000).max(1_000);
/** 3D object-space coordinate (hotspot, painter strokes). */
const world = finite.min(-1e6).max(1e6);

/**
 * Stroke colour. The composer only emits `#rrggbb` (`<input type="color">` and the `userColor`
 * palette); short/alpha forms and a plain CSS name are tolerated. None of these forms can contain a
 * quote, angle bracket or parenthesis — which also serves as a second barrier in front of the
 * server-side SVG rendering.
 */
const color = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/)
  .max(24);

// Volumes: generous for real use, tight against abuse.
const MAX_PARTS = 300;
const MAX_PATH_POINTS = 4_000;
/** Flattened xyz coordinates of a 3D painter stroke (about 4,000 points). */
const MAX_STROKE_COORDS = 12_000;
const MAX_ANIM_KEYS = 2_000;
/**
 * Points of interest per comment. The ceiling is that of a numbered remark someone rereads: beyond
 * twenty points it is another review, not a comment. Mirrors the frontend.
 */
export const MAX_POI_POINTS = 20;
/**
 * Global ceiling of the annotation blob, in JSON bytes. The per-field bounds multiplied together still
 * leave an outsized room (300 parts × 4,000 points): this ceiling brings the worst case back to a
 * realistic order of magnitude. A loaded comment (hotspot + about ten strokes + scene proposal) weighs
 * a few kilobytes.
 */
export const MAX_ANNOTATION_BYTES = 512_000;

/** 2D shape of the annotation overlay — mirror of `v2/components/annotation/geometry.ts`. */
const shapePart = z
  .object({
    type: z.enum(['path', 'rect', 'ellipse', 'arrow', 'polygon', 'text']),
    id: z.string().max(64).optional(),
    color: color.optional(),
    width: finite.min(0).max(100).optional(),
    alpha: finite.min(0).max(1).optional(),
    pts: z.array(z.array(norm).max(4)).max(MAX_PATH_POINTS).optional(),
    x: norm.optional(),
    y: norm.optional(),
    w: norm.optional(),
    h: norm.optional(),
    cx: norm.optional(),
    cy: norm.optional(),
    rx: norm.optional(),
    ry: norm.optional(),
    x1: norm.optional(),
    y1: norm.optional(),
    x2: norm.optional(),
    y2: norm.optional(),
    text: z.string().max(2_000).optional(),
  })
  .strict();

/** 3D surface hotspot (10.G-V10): the point and the normal travel as an "x,y,z" string. */
const hotspotPart = z
  .object({
    type: z.literal('hotspot'),
    position: z.string().max(120),
    normal: z.string().max(120),
    space: z.literal('object').optional(),
  })
  .strict();

/**
 * 3D surface brush stroke (10.G-V9), in the object space of the SplatMesh.
 *
 * `width` is a **screen thickness, in pixels** since phase 50 (batch 8): it used to be a value relative
 * to the scene size, hence world units. The bounds do not change — a reasonable pixel count fits the
 * old ones.
 *
 * `normal` is the direction from which the stroke was painted: it is used to fade it when the viewer
 * moves to the other side of the surface. Optional — strokes written before it was introduced do not
 * have one, and remain fully visible.
 */
const paintPart = z
  .object({
    type: z.literal('splat-paint'),
    points: z.array(world).max(MAX_STROKE_COORDS),
    color,
    width: finite.min(0).max(100),
    normal: z.tuple([world, world, world]).optional(),
  })
  .strict();

/** F-curve key — shape shared with the persisted presentation (`lib/cameraAnimSchema`). */
const curveKey = curveKeySchema({ minTime: -3_600_000, maxTime: 3_600_000, maxValue: 1e6 }).strict();

/** "By channels" v2 camera animation (Phase 17) attached to the comment in layout mode. */
const cameraAnimPart = z
  .object({
    type: z.literal('camera-anim'),
    ...cameraAnimShape(channelSchema(curveKey, { max: MAX_ANIM_KEYS }).strict()),
  })
  .strict();

/** 3D staging proposal (46.D) — same schema as the media's persisted override. */
const sceneOverridePart = z
  .object({ type: z.literal('scene-override'), override: sceneOverrideSchema.nullable() })
  .strict();

/**
 * Crop volumes of a cloud-edit proposal. Same ceiling as the global write route (`media-splat.routes`):
 * the proposal cannot be richer than what a manager could save for everyone.
 */
const MAX_SPLAT_EDIT_VOLUMES = 32;

/** Scale of a cloud or a volume — strictly positive and bounded, as on the route side. */
const splatScale = finite.positive().max(1_000);
const splatVec3 = z.tuple([world, world, world]);
const splatQuat = z.tuple([finite, finite, finite, finite]);
const splatScale3 = z.tuple([splatScale, splatScale, splatScale]);
const splatTrs = { position: splatVec3, quaternion: splatQuat, scale: splatScale3 };

/**
 * **Cloud-edit** proposal attached to a comment (Phase 50, batch 14): the cloud's TRS transform, its SDF
 * crop volumes, the orientation flip on import — and the **deletions**, which are the bulk of the work on
 * a cloud.
 *
 * Twin of `scene-override` for splats: replayed only when reading the comment, and never written into the
 * media. Like the 3D override, it travels WHOLE — nothing of the gesture is left on the dock, otherwise
 * deleting splats for others would have no address in a studio that publishes by default.
 *
 * The two blobs (deletion mask by index, subset ops) do not fit in an annotation: the part carries only
 * their REFERENCE, and the object travels as an attachment of the comment — same folder, same presigned
 * URL, same purge. Everything is in `lib/commentSplatEdit`, including the size ceiling the server checks.
 */
const splatEditPart = z
  .object({
    type: z.literal('splat-edit'),
    transform: z.object(splatTrs).strict().nullable(),
    volumes: z
      .array(
        z
          .object({
            shape: z.enum(['box', 'sphere']),
            mode: z.enum(['delete', 'isolate']),
            ...splatTrs,
          })
          .strict(),
      )
      .max(MAX_SPLAT_EDIT_VOLUMES),
    baseFlip: z.boolean().optional(),
    /** Deletion mask: key of the attached object + number of splats removed. */
    mask: splatEditBlobRef.nullable().optional(),
    /** Subset ops added by the author (delta, not those already on the media). */
    subset: splatEditBlobRef.nullable().optional(),
  })
  .strict();

/** Video range in→out (34.A): the annotation stays visible for the whole range. */
const rangePart = z
  .object({
    type: z.literal('range'),
    inFrame: z.number().int().min(0).max(10_000_000),
    outFrame: z.number().int().min(0).max(10_000_000),
  })
  .strict();

/**
 * A point of interest of a carrying comment (Phase 50, batch 12): the same geometry as a `hotspot`, plus
 * its own remark and the comment's attachments that belong to it (referenced by their MinIO key — the
 * storage of attachments does not change).
 */
const poiPointSchema = z
  .object({
    position: z.string().max(120),
    normal: z.string().max(120),
    space: z.literal('object').optional(),
    text: z.string().max(2_000).optional(),
    images: z.array(z.string().max(512)).max(MAX_COMMENT_ATTACHMENTS).optional(),
  })
  .strict();

/**
 * Points of interest of a comment — **a single part for all the points**, numbered by their rank in the
 * array.
 *
 * The shape was chosen this way rather than one comment per point: a single comment travels, it carries
 * each point's text and images, and so it crosses the whole product (client portal, notes export,
 * ShotGrid) without special cases. `hotspotPart` is still accepted on write: the client portal places
 * only one, and nothing is rewritten in the database.
 */
const poiPart = z
  .object({ type: z.literal('poi'), points: z.array(poiPointSchema).min(1).max(MAX_POI_POINTS) })
  .strict();

const annotationPart = z.union([
  hotspotPart,
  poiPart,
  paintPart,
  cameraAnimPart,
  sceneOverridePart,
  splatEditPart,
  rangePart,
  shapePart,
]);

/**
 * Annotation of a comment: the list of parts the viewer composes
 * (`frontend/src/v2/pages/review/useSubmitComment.ts`).
 */
export const annotationSchema = z
  .array(annotationPart)
  .max(MAX_PARTS)
  // `refine` rather than `addIssue`: Zod's default message is enough, and the caller gets the generic
  // refusal of `parseAnnotation` anyway.
  .refine((parts) => JSON.stringify(parts).length <= MAX_ANNOTATION_BYTES);

const vec3 = z.object({ x: world, y: world, z: world }).strict();

/** 3D viewer view state attached to the pose (display mode, cut, lighting — 39). */
const viewState = z
  .object({
    display: z.string().max(40).optional(),
    section: z
      .object({
        active: z.boolean().optional(),
        axis: z.enum(['x', 'y', 'z']).optional(),
        position: world.optional(),
        flip: z.boolean().optional(),
      })
      .strict()
      .optional(),
    lighting: z
      .object({
        hdriId: z.string().max(200).optional(),
        exposure: finite.min(0).max(100).optional(),
        rotationDeg: finite.min(-3_600).max(3_600).optional(),
        showBackground: z.boolean().optional(),
        groundShadow: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Camera pose attached to a 3D/splat comment — mirror of `SplatCamera`/`ModelCameraState` on the front
 * end, and cousin of `camPose` in `media-splat.routes.ts`. `strict()`: the public share surface accepts
 * it from an unauthenticated guest, so no free key has a place there.
 */
export const cameraStateSchema = z
  .object({
    position: vec3,
    target: vec3,
    fov: finite.min(1).max(179).optional(),
    aspect: finite.min(0.01).max(100).optional(),
    roll: finite
      .min(-2 * Math.PI)
      .max(2 * Math.PI)
      .optional(),
    // Spark depth of field, replicated with the pose (10.G).
    apertureAngle: finite.min(0).max(1).optional(),
    focalDistance: finite.min(0).max(1e6).optional(),
    view: viewState.optional(),
  })
  .strict();

/**
 * Re-reads a blob coming from the client at write time. `undefined`/`null` stay as they are (the field is
 * optional); everything else must enter the schema.
 *
 * Routes already validate with Zod; this second pass exists because not every input goes through a route
 * of this module — `createGuest` is called from the public share surface, and that is precisely the one
 * that must not be missed.
 */
export function parseAnnotation(value: unknown): unknown {
  if (value == null) return undefined;
  const parsed = annotationSchema.safeParse(value);
  // Zod's detail would teach the caller nothing useful: a plain refusal, as elsewhere.
  if (!parsed.success) throw badRequest('Invalid annotation');
  return parsed.data;
}

/**
 * Annotation of a **guest** — narrower than a member's, on purpose.
 *
 * A client draws on the image and places a point on a surface: these are remarks. The four parts removed
 * here are AUTHOR gestures, replayed to the viewers who read the comment: `scene-override` (3D staging
 * proposal, 46.D), `splat-edit` (cloud-edit proposal), `camera-anim` (a by-channel camera animation) and
 * `splat-paint` (3D painter strokes). None makes sense coming from a share link, and accepting them would
 * let an anonymous user holding a URL write into what others see.
 *
 * Volumes are tightened with the same intent: five times fewer parts and eight times fewer bytes than for
 * a member. Generous for a review page, tight for a bot.
 */
const GUEST_MAX_PARTS = 60;
const GUEST_MAX_ANNOTATION_BYTES = 64_000;

export const guestAnnotationSchema = z
  .array(z.union([hotspotPart, shapePart]))
  .max(GUEST_MAX_PARTS)
  .refine((parts) => JSON.stringify(parts).length <= GUEST_MAX_ANNOTATION_BYTES);

/**
 * Same contract as `parseAnnotation`, applied to the public surface. It lives here, as close to the write
 * as possible, rather than in the route: `createGuest` can be called from elsewhere, and that is precisely
 * the caller that must not be missed.
 */
export function parseGuestAnnotation(value: unknown): unknown {
  if (value == null) return undefined;
  const parsed = guestAnnotationSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Invalid annotation');
  return parsed.data;
}

export function parseCameraState(value: unknown): unknown {
  if (value == null) return undefined;
  const parsed = cameraStateSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Invalid cameraState');
  return parsed.data;
}
