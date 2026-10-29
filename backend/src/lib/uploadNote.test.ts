// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { assertUploadNote } from './uploadNote';
import { REVIEW_NOTE_MAX_LENGTH, type ReviewRequestRule } from './projectSettings';
import { AppError } from './errors';

const rule = (requireNote: boolean, minNoteLength = 5): ReviewRequestRule => ({ requireNote, minNoteLength });

/** The refusal code, or `null` when the note passes. */
function codeOf(note: string | null | undefined, r: ReviewRequestRule): string | undefined | null {
  try {
    assertUploadNote(note, r);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).statusCode).toBe(400);
    return (e as AppError).code;
  }
}

describe('assertUploadNote — mandatory note moved to upload (Phase 50)', () => {
  it('lets a missing note through when the project does not require one', () => {
    for (const note of [undefined, null, '', '   ']) {
      expect(codeOf(note, rule(false))).toBeNull();
      expect(assertUploadNote(note, rule(false))).toBeNull();
    }
  });

  it('rejects a missing note when the project requires one', () => {
    for (const note of [undefined, null, '', '   ']) {
      expect(codeOf(note, rule(true))).toBe('UPLOAD_NOTE_REQUIRED');
    }
  });

  it('applies the minimum length to EVERY written note, even optional ones', () => {
    // A two-character note is not a short note: it is an empty field that took the place of
    // an empty field. Same trade-off as for review notes.
    expect(codeOf('ok', rule(false, 5))).toBe('UPLOAD_NOTE_TOO_SHORT');
    expect(codeOf('ok', rule(true, 5))).toBe('UPLOAD_NOTE_TOO_SHORT');
  });

  it('compares after `trim`: five spaces do not satisfy a minimum of five', () => {
    expect(codeOf('     ', rule(true, 5))).toBe('UPLOAD_NOTE_REQUIRED');
  });

  it('returns the note with its edge spaces stripped', () => {
    expect(assertUploadNote('  Regarder le raccord au 1042  ', rule(true))).toBe(
      'Regarder le raccord au 1042',
    );
  });

  it('caps the stored length: the field does not dictate the column size', () => {
    const long = 'a'.repeat(REVIEW_NOTE_MAX_LENGTH + 500);
    expect(assertUploadNote(long, rule(true))).toHaveLength(REVIEW_NOTE_MAX_LENGTH);
  });
});
