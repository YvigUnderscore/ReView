// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClientComment, ReviewComment } from '../../types/api';
import type { UsdVariantSet } from '../../types/usd';
import { DEFAULT_LIGHTING, type LightingConfig } from '../review/reviewTypes';
import { reviewAspect } from '../review/reviewAspect';
import type { VariantSelection } from '../review/three/sceneOverrideApply';
import type { ClientMediaSource } from './clientTypes';

/**
 * Translation of the share payload into what the reused internal viewers expect.
 * Everything is pure: a share has no right to any authenticated request, so these functions
 * are the only place where what is displayable is decided from what the route gives.
 */

/** Extensions Spark can open. `.sogs` is normalized to `.sog` by the viewer. */
const SPLAT_EXT = /\.(ply|spz|splat|ksplat|sog|sogs)(\?|$)/i;
const GLTF_EXT = /\.(glb|gltf)(\?|$)/i;

/**
 * Displayable GLB for a guest: the converted derivative when the route exposes it, otherwise
 * the source file if it is already glTF. `null` means nothing to load: the pane shows its
 * "model not displayable" state rather than a black canvas.
 */
export function resolveClientGlb(source: ClientMediaSource | undefined): string | null {
  if (!source) return null;
  if (source.glbUrl) return source.glbUrl;
  return GLTF_EXT.test(source.url) ? source.url : null;
}

/**
 * Displayable splat file: Spark infers the decoder from the extension, which lives on the
 * media's original name and not on the presigned URL (which carries a signature query).
 */
export function resolveClientSplat(
  source: ClientMediaSource | undefined,
  originalName: string,
): { url: string; fileName: string } | null {
  if (!source) return null;
  const named = SPLAT_EXT.test(originalName);
  if (!named && !SPLAT_EXT.test(source.url)) return null;
  return { url: source.url, fileName: named ? originalName : source.url.replace(/\?.*$/, '') };
}

/**
 * Delivery frame aspect replayed for the guest: exactly the internal review's rule
 * (`reviewAspect`). The aspect frozen in the presentation comes first, otherwise the ratio
 * inherited from pipeline settings served by the share route. The guest annotates in the same
 * frame as the artist, otherwise normalized annotations would not land in the same place.
 */
export function clientFrameAspect(source: ClientMediaSource | undefined): number {
  return reviewAspect({
    presentation: source?.splatPresentation?.camera?.aspect,
    delivery: source?.deliveryAspect,
  }).value;
}

/**
 * Replayed lighting: media-specific setting, otherwise project default, otherwise neutral.
 * Same cascade as the internal review (39.F), merged over `DEFAULT_LIGHTING` to tolerate
 * records that predate a field.
 */
export function clientLighting(source: ClientMediaSource | undefined): LightingConfig {
  const own = source?.splatPresentation?.lighting;
  const project = source?.projectDefaultLighting;
  return { ...DEFAULT_LIGHTING, ...(own ?? project ?? {}) };
}

/** Variant options active at conversion, indexed by prim (base of the override). */
export function clientVariantDefaults(sets: UsdVariantSet[] | null | undefined): VariantSelection {
  const defaults: VariantSelection = {};
  for (const set of sets ?? [])
    defaults[set.prim] = { ...(defaults[set.prim] ?? {}), [set.name]: set.selected };
  return defaults;
}

/**
 * Position in the **media** from the position in the player. The client derivative carries
 * a slate at the head (35.A) that the internal review does not know: without this removal,
 * every guest comment would be offset by the slate duration.
 */
export function mediaTimeOf(playerTime: number, slateSec: number): number {
  return Math.max(0, playerTime - slateSec);
}

/** Inverse: where to place oneself in the player to reach a media position. */
export function playerTimeOf(mediaTime: number, slateSec: number): number {
  return Math.max(0, mediaTime + slateSec);
}

/**
 * Share comments as seen by the internal timeline, which reasons in **player time**: the
 * timestamps are therefore offset by the slate. Fields the share does not expose (reactions,
 * threads, states) stay empty, since the timeline only uses them for display.
 *
 * `annotation` used to be forced to `null`: the drawing did arrive from the server and the
 * front end discarded it, so an annotated note displayed without its stroke. It now travels,
 * and it is what displays when the client clicks a note.
 */
export function toPlayerComments(comments: readonly ClientComment[], slateSec: number): ReviewComment[] {
  return comments.map((c) => ({
    id: c.id,
    content: c.content,
    timestamp: c.timestamp == null ? null : playerTimeOf(c.timestamp, slateSec),
    createdAt: c.createdAt,
    author: c.author ? { id: c.author.id, name: c.author.name } : null,
    guestName: c.guestName,
    // The camera pose stays out of the share: restoring it would mean making the invited
    // spatial viewers controllable, and they are mounted read-only.
    cameraState: null,
    annotation: c.annotation ?? null,
    isEdited: c.isEdited,
    isResolved: false,
  }));
}
