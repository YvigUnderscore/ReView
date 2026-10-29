// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Slots that the review page hands over to the chrome of the mounted viewer.
 *
 * The review used to stack two headers: the page's own (media, version, presence, actions) and
 * the chrome's (mode toggle, viewer A/B). Merging them by prop would have meant passing through
 * `ReviewViewer` and then each of the four branches (video, image, 3D, splat) with three extra
 * nodes, although the page already renders them. The context sets them once; `ReviewChrome`
 * picks them up, whichever viewer mounted it.
 *
 * Outside the review (the editing player), the context is absent: the chrome falls back on its props.
 */
export interface ReviewHeaderSlots {
  /** Media name, draft, version, playlist, edit: left side. */
  identity: ReactNode;
  /** A/B of flat media, ShotGrid, live, presence, publication, actions: right side. */
  actions: ReactNode;
  /** Comments panel, the chrome's last column. `null` when collapsed. */
  comments: ReactNode;
}

export const ReviewHeaderSlotsContext = createContext<ReviewHeaderSlots | null>(null);

/** Slots provided by the page, or `null` outside the review. */
export function useReviewHeaderSlots(): ReviewHeaderSlots | null {
  return useContext(ReviewHeaderSlotsContext);
}
