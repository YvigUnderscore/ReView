// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { ReviewRequestRule } from '../types/api';
import { noteIssue, toNotePayload } from './reviewRequestRule';

/**
 * The request rule is written three times — service, API, screen. These tests hold the third to the
 * same contract as the other two: an active button on a request the server would refuse is the only
 * defect this duplication can produce.
 */

const rule = (requireNote: boolean, minNoteLength = 5): ReviewRequestRule => ({
  requireNote,
  minNoteLength,
});

describe('noteIssue', () => {
  it('tolerates a missing request when the project does not require one', () => {
    expect(noteIssue('', rule(false))).toBeNull();
    expect(noteIssue('   ', rule(false))).toBeNull();
  });

  it('refuses a missing request when the project requires one', () => {
    expect(noteIssue('', rule(true))).toBe('missing');
    // A space is not a request: without `trim`, five spaces would pass the floor.
    expect(noteIssue('     ', rule(true))).toBe('missing');
  });

  it('applies the floor even to an optional request', () => {
    expect(noteIssue('ok', rule(false, 5))).toBe('too-short');
    expect(noteIssue('la lumière', rule(false, 5))).toBeNull();
  });

  it('measures the request after trimming the edge spaces', () => {
    expect(noteIssue('  abc  ', rule(true, 5))).toBe('too-short');
    expect(noteIssue('  abcde  ', rule(true, 5))).toBeNull();
  });
});

describe('toNotePayload', () => {
  it('returns `null` rather than an empty string — the model only knows absence', () => {
    expect(toNotePayload('   ')).toBeNull();
    expect(toNotePayload('')).toBeNull();
  });

  it('trims the edges of what is kept', () => {
    expect(toNotePayload('  la lumière  ')).toBe('la lumière');
  });
});
