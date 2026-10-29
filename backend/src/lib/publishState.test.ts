// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { MediaStatus } from '@prisma/client';
import {
  bornsPublished,
  inheritsPublication,
  shouldPublishVersion,
  shouldUnpublishVersion,
} from './publishState';

const media = (published: boolean, status: MediaStatus = MediaStatus.READY) => ({ published, status });

describe('shouldPublishVersion', () => {
  it('publishes the version when all its media are', () => {
    expect(shouldPublishVersion([media(true), media(true)])).toBe(true);
  });

  it('waits until not a single draft remains', () => {
    expect(shouldPublishVersion([media(true), media(false)])).toBe(false);
  });

  it('does not publish an empty version — it has nothing to show', () => {
    expect(shouldPublishVersion([])).toBe(false);
  });

  it('ignores a failed media, which would block the version forever', () => {
    expect(shouldPublishVersion([media(true), media(false, MediaStatus.FAILED)])).toBe(true);
  });

  it('does not hold back a version whose media have all failed', () => {
    expect(shouldPublishVersion([media(false, MediaStatus.FAILED)])).toBe(false);
  });

  it('counts a published media still being processed', () => {
    // Publication is a visibility decision, not a state of the transcoding pipeline.
    expect(shouldPublishVersion([media(true, MediaStatus.PROCESSING)])).toBe(true);
  });
});

describe('inheritsPublication', () => {
  it('a media joining a published version is born published', () => {
    expect(inheritsPublication(true)).toBe(true);
  });

  it('leaves a draft media in a draft version', () => {
    expect(inheritsPublication(false)).toBe(false);
  });
});

describe('bornsPublished — automatic publication (Phase 50)', () => {
  it('publishes automatically outside draft mode, version published or not', () => {
    expect(bornsPublished({ draftMode: false, versionPublished: false })).toBe(true);
    expect(bornsPublished({ draftMode: false, versionPublished: true })).toBe(true);
  });

  it('falls back exactly on inheritance in draft mode', () => {
    // The historical rule, word for word: a studio that ticks the setting regains its former behaviour, with no exception or new nuance.
    for (const versionPublished of [true, false]) {
      expect(bornsPublished({ draftMode: true, versionPublished })).toBe(
        inheritsPublication(versionPublished),
      );
    }
  });

  it('stays consistent with shouldPublishVersion: the first published media carries the version', () => {
    const born = bornsPublished({ draftMode: false, versionPublished: false });
    expect(shouldPublishVersion([media(born)])).toBe(true);
  });
});

describe('shouldUnpublishVersion', () => {
  it('never unpublishes automatically', () => {
    expect(shouldUnpublishVersion()).toBe(false);
  });
});
