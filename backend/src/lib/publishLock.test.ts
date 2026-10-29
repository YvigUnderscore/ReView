// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { MediaStatus } from '@prisma/client';
import {
  assertReprocessable,
  assertWritable,
  isAllowedWhilePublished,
  publishedReprocessCount,
  PUBLISHED_REPROCESS_ALLOWANCE,
  PUBLISHED_WRITES,
  withPublishedReprocess,
  type PublishedWrite,
} from './publishLock';
import { AppError } from './errors';

/**
 * This file tested the one-word rule of Phase 11: published = frozen, any write answers 403. This rule has been REPLACED by a table
 * of exceptions (Phase 50), because the media is now published as soon as it is uploaded: freezing it entirely would have forbidden
 * the normal review work at the very moment it begins. The test is therefore rewritten around the table, not disabled — and it
 * verifies what remains locked as carefully as what opens, since that is where the choice lies.
 */

/** What `forbidden` raised, in a comparable form. */
function refusal(run: () => void): { status: number; code: string | undefined } {
  try {
    run();
    expect.fail('aurait dû lever');
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return { status: (e as AppError).statusCode, code: (e as AppError).code };
  }
}

const ALL_WRITES: PublishedWrite[] = [
  'splatEdit',
  'usdOverride',
  'usdRecompose',
  'versionTransform',
  'uploadFinalize',
];

describe('publishLock — scope of the table', () => {
  /**
   * Commenting and annotating a PUBLISHED media remain possible: these are remarks, not edits of the content. Nothing submits
   * them to the lock — neither the table (checked here) nor `CommentService.create`, which asks the lock for nothing. The day a
   * comment write presented itself to it, this test would fail.
   */
  it('knows only content writes — none of comment or annotation', () => {
    expect([...PUBLISHED_WRITES].sort()).toEqual([...ALL_WRITES].sort());
    for (const write of PUBLISHED_WRITES) {
      expect(write).not.toMatch(/comment|annotation|poi/i);
    }
  });
});

describe('publishLock.assertWritable — table of exceptions to the lock', () => {
  it('lets ANY write through on a draft', () => {
    for (const write of ALL_WRITES) {
      expect(() => assertWritable({ published: false }, write)).not.toThrow();
    }
  });

  it('opens the USD staging on a published media', () => {
    for (const write of ['usdOverride', 'usdRecompose'] as PublishedWrite[]) {
      expect(isAllowedWhilePublished(write)).toBe(true);
      expect(() => assertWritable({ published: true }, write)).not.toThrow();
    }
  });

  // `videoTrim` left the table with the cut itself (Phase 50, batch 4): there is no "refused for the record" write left — an entry
  // without a caller would be a rule nothing applies any more.
  //
  // `splatEdit` joined the refusals in batch 14. This test expected the opposite, and it is deliberately rewritten: the "for everyone"
  // write of a cloud had been opened after publication, which made a permanent "Save" button appear in a studio without drafts — and
  // rewrote the cloud under the eyes of those commenting on it. The edit is not lost: it travels in a comment (`splat-edit` part).
  it('keeps the cloud edit, the version transform and the re-finalisation locked', () => {
    for (const write of ['splatEdit', 'versionTransform', 'uploadFinalize'] as PublishedWrite[]) {
      expect(isAllowedWhilePublished(write)).toBe(false);
      expect(refusal(() => assertWritable({ published: true }, write))).toEqual({
        status: 403,
        code: 'PUBLISHED_LOCKED',
      });
    }
  });

  /**
   * The splat's PRESENTATION (`splatPresentation`: base camera, DoF, reveal, LOD, lighting) remains allowed after publication — and
   * it stays so because it does not present itself before the lock at all: `SplatEditService.setSplatPresentation` does not call
   * `assertWritable`. This test guards that absence: the day someone added `splatPresentation` to the table, its value would have
   * to be chosen, and it would show here.
   */
  it('does not route the splat staging through the lock', () => {
    expect(PUBLISHED_WRITES).not.toContain('splatPresentation');
  });
});

describe('publishLock.assertReprocessable — one retry after failure, not two', () => {
  const failed = (metadata: unknown = {}) => ({
    published: true,
    status: MediaStatus.FAILED,
    metadata,
  });

  it('lets a draft be reprocessed, whatever its state', () => {
    expect(() =>
      assertReprocessable({ published: false, status: MediaStatus.READY, metadata: {} }),
    ).not.toThrow();
  });

  it('refuses the reprocessing of a HEALTHY published media, with its own code', () => {
    expect(
      refusal(() => assertReprocessable({ published: true, status: MediaStatus.READY, metadata: {} })),
    ).toEqual({ status: 403, code: 'REPROCESS_ONLY_AFTER_FAILURE' });
  });

  it('allows the first reprocessing of a published media in failure', () => {
    expect(() => assertReprocessable(failed())).not.toThrow();
    expect(() => assertReprocessable(failed(null))).not.toThrow();
  });

  it('refuses the second, once the reprocessing has been consumed', () => {
    const spent = withPublishedReprocess({ fps: 24 });
    expect(spent).toEqual({ fps: 24, publishedReprocessCount: PUBLISHED_REPROCESS_ALLOWANCE });
    expect(refusal(() => assertReprocessable(failed(spent)))).toEqual({
      status: 403,
      code: 'REPROCESS_ALREADY_RETRIED',
    });
  });

  it('reads a damaged counter as zero rather than blocking catch-up', () => {
    expect(publishedReprocessCount(undefined)).toBe(0);
    expect(publishedReprocessCount({ publishedReprocessCount: 'deux' })).toBe(0);
    expect(publishedReprocessCount({ publishedReprocessCount: -3 })).toBe(0);
    expect(publishedReprocessCount({ publishedReprocessCount: 1.9 })).toBe(1);
    expect(() => assertReprocessable(failed({ publishedReprocessCount: 'deux' }))).not.toThrow();
  });
});
