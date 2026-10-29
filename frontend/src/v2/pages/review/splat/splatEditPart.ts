// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommentAttachment } from '../../../../lib/commentAttachments';
import type { SdfVolumeData, SplatEdits, SplatTransform } from '../reviewTypes';

/**
 * Cloud-edit proposal attached to a comment (Phase 50, lot 14): the `splat-edit` part, twin of
 * `scene-override` for the splat.
 *
 * It is the same contract as the server side (`lib/commentPayload`) seen from the other end, and it
 * carries the WHOLE gesture: the TRS transform of the cloud, the crop volumes, the orientation flip,
 * **and the deletions**, which are the bulk of the work on a cloud.
 *
 * The two blobs (deletion mask per index, subset ops) do not fit in an annotation: they go as
 * attachments of the comment, and the part keeps only their key. Reading resolves this key only
 * among the attachments OF THE SAME comment, already filtered by prefix on the server side: a
 * foreign key therefore gives no URL.
 *
 * Writing is strict (Zod on the server side); READING, for its part, tolerates the unexpected: the
 * column is free JSON, and a damaged part, or one written by an earlier version, must not break the
 * reading of the comment that carries it.
 */

/** A blob of the proposal as the editor produces it, before upload. */
export interface SplatEditBlob {
  bytes: Uint8Array;
  /** Masked splats, or replayed ops: for display, never for authority. */
  count: number;
}

/** The same blob once deposited: what the part actually carries. */
export interface SplatEditBlobRef {
  key: string;
  count: number;
}

/** What the editor proposes for the next comment: the bounded part plus the two binaries. */
export interface SplatEditDraft {
  edits: SplatEdits;
  mask: SplatEditBlob | null;
  subset: SplatEditBlob | null;
}

/** The part read back, keys included. */
export interface SplatEditPartData extends SplatEdits {
  mask: SplatEditBlobRef | null;
  subset: SplatEditBlobRef | null;
}

/**
 * The proposal as it is REPLAYED: the bounded part, plus the presigned URLs of the two blobs,
 * resolved among the attachments of the carrying comment.
 */
export interface SplatEditProposal extends SplatEdits {
  maskUrl: string | null;
  subsetUrl: string | null;
  /** Counts declared by the author: to show on screen, not to replay. */
  maskCount: number;
  subsetCount: number;
}

/** Triplet (or quadruplet) of finite numbers: the shape the gizmos produce. */
function isTuple(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Readable TRS transform: position, quaternion and scale in full. */
function isSplatTransform(value: unknown): value is SplatTransform {
  const trs = value as SplatTransform | null | undefined;
  return !!trs && isTuple(trs.position, 3) && isTuple(trs.quaternion, 4) && isTuple(trs.scale, 3);
}

/** Readable crop volume: shape and mode known, full TRS. */
function isSdfVolume(value: unknown): value is SdfVolumeData {
  const vol = value as SdfVolumeData | null | undefined;
  return (
    !!vol &&
    (vol.shape === 'box' || vol.shape === 'sphere') &&
    (vol.mode === 'delete' || vol.mode === 'isolate') &&
    isSplatTransform(vol)
  );
}

/** Readable blob reference: a non-empty key and a positive count. */
function isBlobRef(value: unknown): value is SplatEditBlobRef {
  const ref = value as SplatEditBlobRef | null | undefined;
  return !!ref && typeof ref.key === 'string' && ref.key.length > 0 && typeof ref.count === 'number';
}

/**
 * Reads the `splat-edit` part of an annotation already split into parts. Returns `null` when there
 * is nothing replayable: an empty part must not make a proposal appear, otherwise the viewer's
 * banner would light up for a comment that proposes nothing.
 */
export function readSplatEditPart(parts: Array<{ type?: string }>): SplatEditPartData | null {
  const part = parts.find((x) => x?.type === 'splat-edit') as Partial<SplatEditPartData> | undefined;
  if (!part) return null;
  const transform = isSplatTransform(part.transform) ? part.transform : null;
  const volumes = Array.isArray(part.volumes) ? part.volumes.filter(isSdfVolume) : [];
  const flip = typeof part.baseFlip === 'boolean' ? part.baseFlip : undefined;
  const mask = isBlobRef(part.mask) ? part.mask : null;
  const subset = isBlobRef(part.subset) ? part.subset : null;
  if (!transform && volumes.length === 0 && flip === undefined && !mask && !subset) return null;
  return { transform, volumes, ...(flip === undefined ? {} : { baseFlip: flip }), mask, subset };
}

/**
 * Proposal ready to replay: blob keys are replaced by the presigned URLs of the attachments of the
 * carrying comment.
 *
 * A key not found gives a null URL, not an error: the attachment may have been removed from the
 * comment since. The rest of the proposal still replays.
 */
/**
 * MinIO keys of the two binaries of a proposal, read directly from the annotation.
 *
 * They are deposited as ordinary attachments of the comment: that is what gives them, for free,
 * storage, presigning and above all the PURGE. The downside is that they would appear under the
 * comment as files to download (`splat-mask.bin`), which they are not: nobody opens a bitset. The
 * attachment list therefore excludes them by this key, and by this key alone: a `.bin` file that
 * someone really attaches stays offered.
 */
export function splatEditBlobKeys(annotation: unknown): string[] {
  if (!Array.isArray(annotation)) return [];
  const part = readSplatEditPart(annotation as Array<{ type?: string }>);
  if (!part) return [];
  return [part.mask?.key, part.subset?.key].filter((key): key is string => !!key);
}

export function resolveSplatEditProposal(
  part: SplatEditPartData | null,
  attachments?: readonly CommentAttachment[],
): SplatEditProposal | null {
  if (!part) return null;
  const urlOf = (ref: SplatEditBlobRef | null): string | null =>
    (ref && attachments?.find((a) => a.key === ref.key)?.url) || null;
  const { mask, subset, ...edits } = part;
  return {
    ...edits,
    maskUrl: urlOf(mask),
    subsetUrl: urlOf(subset),
    maskCount: mask?.count ?? 0,
    subsetCount: subset?.count ?? 0,
  };
}

/** Does the current edit have anything to propose? (otherwise nothing is sent: neither blob nor part) */
export function hasSplatEditProposal(draft: SplatEditDraft | null): boolean {
  if (!draft) return false;
  return (
    !!draft.mask ||
    !!draft.subset ||
    draft.edits.volumes.some(isSdfVolume) ||
    draft.edits.baseFlip === false ||
    (isSplatTransform(draft.edits.transform) && !isIdentity(draft.edits.transform))
  );
}

/**
 * Part to attach to the next comment, or `null` when the current edit has nothing to say.
 *
 * Symmetric to the reading: what is sent is exactly what is replayed, and nothing more. Hence the
 * field-by-field copy rather than spreading the editor's object, which would carry into a
 * `strict()` schema any internal field added tomorrow.
 */
export function buildSplatEditPart(
  edits: SplatEdits | null,
  refs?: { mask?: SplatEditBlobRef | null; subset?: SplatEditBlobRef | null },
): Record<string, unknown> | null {
  const mask = refs?.mask ?? null;
  const subset = refs?.subset ?? null;
  // An identity TRS proposes nothing: attaching it would light the reader's banner for a comment
  // that moves nothing. A mask, on the other hand, IS a proposal on its own: it is the cleaning of
  // a cloud, the most common gesture of the splat viewer.
  const moves = !!edits && isSplatTransform(edits.transform) && !isIdentity(edits.transform);
  const volumes = edits?.volumes.filter(isSdfVolume) ?? [];
  if (!moves && volumes.length === 0 && edits?.baseFlip !== false && !mask && !subset) return null;
  return {
    type: 'splat-edit',
    transform: moves ? edits.transform : null,
    volumes,
    ...(edits?.baseFlip === undefined ? {} : { baseFlip: edits.baseFlip }),
    ...(mask ? { mask } : {}),
    ...(subset ? { subset } : {}),
  };
}

/**
 * Does the transform leave the cloud exactly where it was?
 *
 * The identity value is written here rather than imported from `reviewTypes`: this module is itself
 * read by `reviewTypes`, and importing only TYPES from it keeps the dependency entirely erased at
 * compile time: no runtime cycle.
 */
function isIdentity(trs: SplatTransform): boolean {
  const [qx, qy, qz, qw] = trs.quaternion;
  return (
    trs.position.every((v) => v === 0) &&
    qx === 0 &&
    qy === 0 &&
    qz === 0 &&
    qw === 1 &&
    trs.scale.every((v) => v === 1)
  );
}
