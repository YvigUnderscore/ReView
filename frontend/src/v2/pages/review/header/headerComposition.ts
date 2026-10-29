// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '../../../types/api';
import type { CompareMode } from '../useCompareState';

/**
 * Composition of the review header, decided outside rendering.
 *
 * A single header since the merge: the viewer chrome carries identity on the left, actions on the
 * right. What varies from one media to another (the A/B selector exists only for flat media, the
 * detachable player only for video) is described here rather than scattered as conditions across
 * the JSX, so that it can be verified for all four types.
 */

/** Actions of the right corner, in display order. */
export type HeaderActionId =
  | 'compare'
  | 'shotgrid'
  | 'live'
  | 'presence'
  | 'publish'
  | 'decision'
  | 'pip'
  | 'theater'
  | 'shortcuts'
  | 'comments';

export interface HeaderActionContext {
  kind: MediaKind;
  /** Published media: no publish button any more (the publication lock is final). */
  published: boolean;
  /** The project is linked to ShotGrid **and** this version has its counterpart there. */
  hasSgLink: boolean;
  /** At least one other viewer on the media. */
  hasViewers: boolean;
  /** The detachable player is offered by the page (video only). */
  canPictureInPicture: boolean;
}

/**
 * Actions offered on the right of the merged header.
 *
 * The A/B selector appears here only for video, the only one that ticks two or three versions at
 * once (2×2 grid). The image chooses A and B in the options bar of the "Compare" mode: a single
 * visible place, instead of a header menu and a dock tab that contradicted each other. 3D and
 * splat mount their own (`SpatialCompareHeader`), which arrives through the chrome's `headerRight`
 * prop, just before this list.
 */
export function headerActions(ctx: HeaderActionContext): HeaderActionId[] {
  return [
    ...(ctx.kind === 'VIDEO' ? (['compare'] as const) : []),
    ...(ctx.hasSgLink ? (['shotgrid'] as const) : []),
    'live',
    ...(ctx.hasViewers ? (['presence'] as const) : []),
    ...(ctx.published ? [] : (['publish'] as const)),
    'decision',
    ...(ctx.kind === 'VIDEO' && ctx.canPictureInPicture ? (['pip'] as const) : []),
    'theater',
    'shortcuts',
    'comments',
  ];
}

/**
 * Image comparison overlay: which of the two views replaces the viewer **within** the viewport.
 * Wipe and difference used to unmount the whole chrome: the mode toggle and the A/B settings went
 * with them, at the precise moment they were needed. They are now overlays of the viewport, as for
 * video.
 */
export function imageCompareOverlay(compareId: number | null, mode: CompareMode): 'wipe' | 'diff' | null {
  if (compareId == null || mode === 'side') return null;
  return mode;
}

export interface ChromeHostInput {
  /** The media is loaded: without it, no branch mounts any chrome. */
  hasData: boolean;
  kind?: MediaKind;
}

/**
 * Does the viewer chrome host the header? True as soon as a branch mounts one, hence for the four
 * media types. Only loading mounts none, and the page then renders the header itself rather than
 * letting it disappear.
 */
export function chromeHostsHeader({ hasData, kind }: ChromeHostInput): boolean {
  return hasData && !!kind;
}
