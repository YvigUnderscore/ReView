// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';
import { forbidden } from './errors';

/**
 * Publication lock — what it freezes, and what it no longer freezes (Phase 50).
 *
 * Phase 11 laid down a one-word rule: published = frozen. It held because publication was an end-of-line gesture. Since the media is
 * published **as soon as it is uploaded** (`draftMode` setting disabled by default), the same rule would freeze the media at the moment
 * the artist is only starting to work on it: recomposing a USD scene or relaunching a failed transcode would become impossible without
 * re-uploading.
 *
 * The lock is therefore **kept, and its table of exceptions written in black and white**. What remains locked is so by choice, not by
 * oversight — which is precisely why each entry of the table carries its reason, and why no call was simply removed: the service asks
 * the lock, and the lock answers according to the table.
 *
 * Dividing line: a write that **corrects the reading** of a media without rewriting what was delivered (non-destructive edits, staging,
 * recovery of a failed processing) is allowed; one that **changes the delivery** under the eyes of those who have already seen and
 * commented on it is refused. To change the delivery, there remains only one route: a new version.
 */

/** The writes that come before the lock, named once and for all. */
export type PublishedWrite =
  'splatEdit' | 'usdOverride' | 'usdRecompose' | 'versionTransform' | 'uploadFinalize';

/**
 * The table. `true` = the write remains allowed on a published media; the reason is alongside.
 *
 * It is exhaustive by construction (`Record<PublishedWrite, …>`): adding a write to the type forces its case to be decided here, instead
 * of letting it fall back on a default nobody chose.
 */
const ALLOWED_WHILE_PUBLISHED: Record<PublishedWrite, boolean> = {
  // Splat edits written FOR EVERYONE (splat-edits JSON, deletion mask, subsets): closed in phase 50, batch 14. They had been opened so that
  // cleaning a cloud remained possible after an automatic publication — the result was that a studio without drafts saw a permanent "Save"
  // button above the viewer, which rewrote under everyone's eyes what they were commenting on.
  //
  // The cleaning is not lost for all that: it now travels INSIDE a comment, like the 3D staging proposal (`splat-edit` part of
  // `lib/commentPayload`), and is replayed only when reading that comment. The splat thus aligns with the 3D model: the common base is
  // fixed before publication, the proposal after.
  //
  // What REMAINS allowed after publication, and deliberately does not go through this table: `splatPresentation` (staging — base camera,
  // DoF, reveal, LOD, lighting), which is presentation and not content.
  splatEdit: false,
  // USD scene override (46.D): a staging replayed when the viewer loads. Same nature as `splatPresentation`, which was already an exception since phase 11.
  usdOverride: true,
  // USD recomposition (46): choosing the variants and the purpose to bake. It is the gesture that makes a scene readable; it does not replace
  // the delivered file, it derives a representation of it.
  usdRecompose: true,
  // Transform of a published version: it is the foundation of the A/B comparison and of annotations anchored to the frame. Moving it afterwards
  // falsifies everything that refers to it.
  versionTransform: false,
  // Finalisation of an already finalised upload: would rewrite the status, size and pipeline of a media whose content has been broadcast.
  // The caller keeps its nuance for the media still in UPLOADING, which was never served to anyone (cf. MediaService.finalize).
  uploadFinalize: false,
};

/**
 * The writes the lock knows, enumerated — this is what makes its SCOPE verifiable.
 *
 * The lock only keeps writes to the CONTENT of a media. Commenting and annotating are not part of it and need not enter it: a remark is not
 * an edit of the media, and a published media is precisely the one being reviewed. An addition to this list is therefore visible in a test,
 * instead of silently closing a door nobody meant to close.
 */
export const PUBLISHED_WRITES = Object.keys(ALLOWED_WHILE_PUBLISHED) as PublishedWrite[];

/** Is the write allowed on a published media? Reads the table, without throwing. */
export function isAllowedWhilePublished(write: PublishedWrite): boolean {
  return ALLOWED_WHILE_PUBLISHED[write];
}

/**
 * Write guard: lets a draft through, and a published media whose write appears in the table of exceptions. Refuses the rest with 403 `PUBLISHED_LOCKED`.
 */
export function assertWritable(entity: { published: boolean }, write: PublishedWrite): void {
  if (!entity.published || ALLOWED_WHILE_PUBLISHED[write]) return;
  throw forbidden('Editing is locked once published', 'PUBLISHED_LOCKED');
}

/**
 * Processing retries granted to a **published** media whose processing failed.
 *
 * One only, and it leads to a real dead end: a media published by default whose transcode fails would be dead for good — neither reprocessable
 * (lock) nor replaceable in place. One retry is enough to recover from the infrastructure incident; beyond that, the failure lies in the file, and
 * what is needed is a new version, not a fourth attempt occupying the queue.
 */
export const PUBLISHED_REPROCESS_ALLOWANCE = 1;

/**
 * `metadata` field carrying the counter. In `metadata` and not in a column: the exception is bounded to one operational case and is not worth a schema migration.
 */
const REPROCESS_COUNT_KEY = 'publishedReprocessCount';

/** Retries already consumed by this published media — absent, unreadable or negative ⇒ zero. */
export function publishedReprocessCount(metadata: unknown): number {
  const raw = (metadata as Record<string, unknown> | null | undefined)?.[REPROCESS_COUNT_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** `metadata` with one more retry on the counter — the rest intact. */
export function withPublishedReprocess(metadata: unknown): Record<string, unknown> {
  return {
    ...((metadata ?? {}) as Record<string, unknown>),
    [REPROCESS_COUNT_KEY]: publishedReprocessCount(metadata) + 1,
  };
}

/** What is needed to know about a media in order to decide a retry. */
export interface ReprocessCandidate {
  published: boolean;
  status: MediaStatus;
  metadata: unknown;
}

/**
 * Can this media's processing be reprocessed?
 *
 * A draft: always. A published media: only if its processing has FAILED, and only once. The two refusals carry their own code — a generic 403
 * would let the interface say "locked" where the true answer is "this media is fine" or "the retry has already been consumed".
 */
export function assertReprocessable(media: ReprocessCandidate): void {
  if (!media.published) return;
  if (media.status !== MediaStatus.FAILED)
    throw forbidden(
      'A published media whose processing succeeded cannot be reprocessed — upload a new version',
      'REPROCESS_ONLY_AFTER_FAILURE',
    );
  if (publishedReprocessCount(media.metadata) >= PUBLISHED_REPROCESS_ALLOWANCE)
    throw forbidden(
      'This published media has already used its single reprocess attempt',
      'REPROCESS_ALREADY_RETRIED',
    );
}
