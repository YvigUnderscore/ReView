// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Anchoring of a React layer on the hotspots of a spatial viewer.
 *
 * The numbered hotspots of the points of interest are placed and **repositioned at each drawn frame** by
 * imperative code (`three/objectHotspot`), in the viewer's container. A React layer that wanted to follow
 * the points would have to reproject along with them, and both viewers render **on demand**
 * (`viewer/renderScheduler`): a layer that measured in a loop would keep the viewer awake permanently.
 *
 * Hence this contract: the layer projects NOTHING. It anchors **inside** the hotspot through a portal and
 * inherits its transform, so the projection already done comes for free, and so does its hiding when the
 * point passes behind the camera. The viewer's container is the only surface that both sides already know
 * (`containerRef` for React, `container` for the marker): the announcement goes through it, and nothing
 * else links them.
 */

/** Attribute of a hotspot: its rank, the only thing the layer needs in order to anchor itself to it. */
export const POI_ANCHOR_ATTR = 'data-poi-anchor';

/** Announcement made on the container when the set of hotspots changes (placement, removal). */
export const POI_ANCHORS_EVENT = 'review:poi-anchors';

/** Attribute of an anchored card: the other end of the contract, see `isPoiCardGesture`. */
export const POI_CARD_ATTR = 'data-poi-card';

/**
 * The gesture landed on a card anchored in the scene: one READS a comment, one does not navigate. The
 * review area hides the 2D drawing at the first navigation gesture (it only makes sense from the original
 * camera): unfolding a card or scrolling its text is not one.
 */
export function isPoiCardGesture(target: unknown): boolean {
  return target instanceof Element && target.closest(`[${POI_CARD_ATTR}]`) !== null;
}

/** Rank carried by a hotspot (`-1` if the attribute is missing: it will go to the end of the list). */
const rankOf = (el: Element): number => Number(el.getAttribute(POI_ANCHOR_ATTR) ?? -1);

/** Hotspots present in the container, sorted by rank (the index = the rank of the point). */
export function poiAnchors(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(`[${POI_ANCHOR_ATTR}]`)).sort(
    (a, b) => rankOf(a) - rankOf(b),
  );
}

/** Announces a change of the set: called by the marker, never by the layer. */
export function announcePoiAnchors(container: HTMLElement): void {
  container.dispatchEvent(new CustomEvent(POI_ANCHORS_EVENT));
}

/**
 * Subscribes to the hotspots of a container: `listen` is played **immediately** with those that already
 * exist (the layer may mount after them, as before them), then at each announcement. Returns the
 * unsubscribe function.
 */
export function subscribePoiAnchors(
  container: HTMLElement | null,
  listen: (anchors: HTMLElement[]) => void,
): () => void {
  listen(poiAnchors(container));
  if (!container) return () => undefined;
  const onChange = () => listen(poiAnchors(container));
  container.addEventListener(POI_ANCHORS_EVENT, onChange);
  return () => container.removeEventListener(POI_ANCHORS_EVENT, onChange);
}

/** Two identical lists of hotspots, node by node: a layer then has nothing left to redo. */
export function sameAnchors(a: readonly HTMLElement[], b: readonly HTMLElement[]): boolean {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}
