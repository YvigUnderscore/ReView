// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { badRequest } from './errors';
import { checkReviewNote, REVIEW_NOTE_MAX_LENGTH, type ReviewRequestRule } from './projectSettings';

/**
 * The note that accompanies an upload (Phase 50).
 *
 * The project setting `reviewRequest` applied to the PUBLICATION of a draft: that is where a
 * delivery without a word of explanation was refused. Publication no longer being a deliberate
 * act, the rule would have evaporated with it: a studio that ticked "mandatory note" would have
 * stopped receiving notes without anything telling it. It therefore applies to the upload, the
 * only moment when someone is still delivering.
 *
 * The function lives in a `lib` and not in a service because the upload has **two** finalizations:
 * a single file (`MediaService.finalize`) and an image sequence (`ImageSequenceService.completeSequence`).
 * Two copies of the rule would have made the sequence a back door around the mandatory note.
 */

/**
 * Checks the note and returns the form to store (`null` when there is none).
 *
 * The minimum length applies to every written note, mandatory or not: it is the rule already in
 * force for review notes, and two different minimums for the same setting would have been
 * impossible to explain. The two refusals carry distinct codes: "one is required" and "this one
 * is too short" do not call for the same correction from the person delivering.
 */
export function assertUploadNote(note: string | null | undefined, rule: ReviewRequestRule): string | null {
  const verdict = checkReviewNote(note, rule);
  if (verdict === 'missing')
    throw badRequest('This project requires a note with every upload', 'UPLOAD_NOTE_REQUIRED');
  if (verdict === 'too-short')
    throw badRequest('The upload note is shorter than this project requires', 'UPLOAD_NOTE_TOO_SHORT');
  const text = (note ?? '').trim();
  return text ? text.slice(0, REVIEW_NOTE_MAX_LENGTH) : null;
}
