// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { linkFor } from './notificationTarget';

/**
 * The destination of a notification. Two defects lived here:
 *
 * - the `REVIEW_DECISION` type was missing from the table, so a review's verdict (the most awaited notification of the batch)
 *   fell back on the project page;
 * - the same event wrote two `referenceId`s of different natures (a version id for the author, a media id for followers).
 *   The server now writes only one, so the front end refuses rows in the old spelling, whose reference is unreliable.
 */
const base = { projectId: 12 };

describe('linkFor', () => {
  it('opens the assigned task', () => {
    expect(linkFor({ ...base, type: 'TASK_ASSIGNED', referenceId: 5 })).toBe('/tasks/5');
  });

  it('opens the review for all the types carried by a media', () => {
    for (const type of ['REPLY', 'COMMENT_ASSIGNED', 'REVIEW_ASSIGNED', 'MENTION', 'WATCH']) {
      expect(linkFor({ ...base, type, referenceId: 9 })).toBe('/review/9');
    }
  });

  it('opens the review on a review decision', () => {
    expect(linkFor({ ...base, type: 'REVIEW_DECISION', referenceId: 9 })).toBe('/review/9');
  });

  it('leaves the old `review_decision` rows on the project page', () => {
    // Their `referenceId` is a VERSION id on the author's side: routing them to /review would open a randomly chosen
    // media. The project fallback is the earlier behaviour.
    expect(linkFor({ ...base, type: 'review_decision', referenceId: 9 })).toBe('/projects/12');
  });

  it('falls back on the project when the reference is missing', () => {
    expect(linkFor({ ...base, type: 'MENTION', referenceId: null })).toBe('/projects/12');
    expect(linkFor({ ...base, type: 'SYSTEM', referenceId: null })).toBe('/projects/12');
  });

  it('leads nowhere without a project or a reference', () => {
    expect(linkFor({ type: 'SYSTEM', referenceId: null, projectId: null })).toBeNull();
  });
});
