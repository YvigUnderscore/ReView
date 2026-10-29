// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext } from 'react';

/** Size in pixels: available area of a pane, or display box of a media. */
export interface Size {
  w: number;
  h: number;
}

/** An area only takes part in the computation once measured: a pane not yet laid out counts as 0. */
const measured = (z: Size): boolean => z.w > 0 && z.h > 0;

/**
 * "Contain" box of a media within an area: it fills the area without exceeding it, **whatever
 * its source resolution**. This is the whole remedy for the initial complaint. Video B was
 * displayed at its natural size, tiny in the middle of its half as soon as the pane was wider,
 * and the eye compared two sizes before comparing two images.
 */
export function containBox(zone: Size, aspect: number): Size {
  if (!measured(zone) || !(aspect > 0)) return { w: 0, h: 0 };
  const h = Math.min(zone.h, zone.w / aspect);
  return { w: h * aspect, h };
}

/**
 * Common area of several panes: the smallest width and the smallest height, hence the
 * rectangle that fits in **all** panes. In a comparison, each media fits into that one rather
 * than its own. The master pane carries the timeline and transport, the B panes a header or
 * a HUD, so their areas never have the same height. Two "contain" fits, each on its own,
 * gave two different display sizes.
 *
 * Unmeasured areas are ignored: a pane that has just mounted reports 0 × 0, and the minimum
 * would have crushed the display of all the others.
 */
export function commonZone(zones: Size[]): Size | null {
  const known = zones.filter(measured);
  if (known.length === 0) return null;
  return {
    w: Math.min(...known.map((z) => z.w)),
    h: Math.min(...known.map((z) => z.h)),
  };
}

/** Registers the measured area of a pane, or removes it (`null`) when the pane disappears. */
export type PublishZone = (id: string, size: Size | null) => void;

/**
 * Two contexts rather than one object: the registration must be **stable**. Carried by the
 * same object as the common area, it changed identity at each measurement. The effect that
 * registers re-ran, unregistered and re-registered, and the loop never stopped.
 *
 * Exported only for `CompareFitProvider`, which feeds them. The panes go through the two hooks
 * below. The provider lives in its own file: a module that exports a component may not also
 * export functions (Fast Refresh).
 */
export const PublishContext = createContext<PublishZone | null>(null);
export const ZoneContext = createContext<Size | null>(null);

/** Registration of the current pane; `null` outside a `CompareFitProvider`. */
export function useCompareFitPublish(): PublishZone | null {
  return useContext(PublishContext);
}

/** Common area of the pane group; `null` outside a provider or until at least one pane is measured. */
export function useCompareFitZone(): Size | null {
  return useContext(ZoneContext);
}
