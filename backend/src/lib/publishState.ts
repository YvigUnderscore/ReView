// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';

/**
 * Publication state of a version with regard to its media — PURE analysis, tested.
 *
 * A version is no longer an object published separately: it is published **because** its media are. Publishing three files one by one
 * then remembering to publish the version on top was a bookkeeping nobody kept, and it left "draft" versions full of media visible to the whole team.
 *
 * Two rules, symmetric:
 *  - all media published → the version is;
 *  - the version published → a media joining it is too.
 */

/** What needs to be known about a media to decide. */
export interface MediaPublishState {
  published: boolean;
  status: MediaStatus;
}

/**
 * A failed media does not count: it will never be published, and letting it weigh would prevent the version from ever being published
 * because of a dead file.
 */
const counts = (media: MediaPublishState) => media.status !== MediaStatus.FAILED;

/**
 * Must the version come out published? There must be at least one media — an empty version has nothing to show — and all those that
 * count must be published.
 */
export function shouldPublishVersion(media: readonly MediaPublishState[]): boolean {
  const kept = media.filter(counts);
  return kept.length > 0 && kept.every((m) => m.published);
}

/**
 * A media added to an already published version is born published.
 *
 * It is the necessary counterpart of the previous rule: without it, adding a render to a published version would make it drop back to draft
 * in the eyes of the calculation, or would force republishing by hand what already was.
 */
export function inheritsPublication(versionPublished: boolean): boolean {
  return versionPublished;
}

/**
 * Is a newly created media born published? (Phase 50 — automatic publication)
 *
 * It is the third rule of the family, and it does not bypass the other two: it extends them. Outside draft mode, every media is born published,
 * which makes `shouldPublishVersion` true as soon as the first file is finalised — the version follows its media, exactly as before. In draft mode,
 * nothing changes: only the inheritance of the published version gives a media published at birth.
 *
 * Draft thus becomes a studio setting rather than a product step: the "publish" gesture only existed to catch up a review that nobody did, and it
 * left deliverables invisible to the team waiting for them.
 */
export function bornsPublished(input: { draftMode: boolean; versionPublished: boolean }): boolean {
  return input.draftMode ? inheritsPublication(input.versionPublished) : true;
}

/**
 * A published version never comes back down on its own. Unpublishing is a supervisor's decision (it removes the version from the sharing links,
 * along with its review decisions): it cannot be the side effect of deleting a media.
 */
export function shouldUnpublishVersion(): false {
  return false;
}
