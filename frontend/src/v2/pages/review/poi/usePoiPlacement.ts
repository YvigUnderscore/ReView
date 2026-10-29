// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { MarkerHandlers } from '../three/objectHotspot';
import type { Hotspot3D } from '../reviewTypes';
import { isClickGesture } from '../three/usdPicking';
import type { Annotations } from '../useAnnotations';
import { useT } from '@/v2/i18n';

/**
 * Minimal contract of a spatial viewer capable of carrying points of interest. The 3D model and the splat
 * both fulfil it, and that is what makes the implementation **unique**.
 */
export interface PoiViewer {
  ready: boolean;
  getSceneHandle: () => { dom: HTMLElement } | null;
  hotspotAtPointer: (clientX: number, clientY: number) => Hotspot3D | null;
  /** Arms (or disarms) the moving and designation of the scene's hotspots. */
  setPoiHandlers: (handlers: MarkerHandlers | null) => void;
  /** Rank of the hotspot put forward, or `null`. */
  setPoiActive: (index: number | null) => void;
}

/**
 * Places points of interest **on click**, in both spatial viewers.
 *
 * What changes in Phase 50 (batch 12): `armed` is no longer a local state toggled by a button of the
 * options bar; it is the RAIL'S TOOL. Arming the tool means being in placement mode: the next click in
 * the view places a point, without an intermediate button. That was the user's first request, and it is
 * also what unlocked the splat, where the button was the only route and nothing said that the viewer was
 * awaiting a click.
 *
 * A click in the void places nothing (and says so); a drag remains an orbit; Escape leaves placement
 * (`onExit`, which returns the tool to rest on the rail). While a point is in preparation, the hotspots
 * are manipulable: pulling them moves them, clicking them designates the row being edited.
 */
export function usePoiPlacement({
  viewer,
  armed,
  ann,
  onExit,
}: {
  viewer: PoiViewer;
  /** The "Point of interest" tool is armed in the rail: the viewer is IN PLACEMENT. */
  armed: boolean;
  /**
   * The composer AND the reading: the hook takes its draft there (`ann.poi`) and what a reviewed comment
   * displays (`ann.viewedPoi`). The two viewers passed the same derivations, word for word: the rule lives here once.
   */
  ann: Annotations;
  /** Escape: the rail takes back its resting tool. */
  onExit: () => void;
}): void {
  const t = useT();
  const { ready, getSceneHandle, hotspotAtPointer, setPoiHandlers, setPoiActive } = viewer;
  const { poi, setViewedPoi } = ann;
  /*
   * What is on screen: the points of the reviewed comment if there is one, otherwise the draft
   * (`usePoiDisplay` gives them priority: clicking a comment must show it, even in the middle of a drafting).
   *
   * Two consequences, and that is the whole role of this flag: the hotspots of a reviewed comment remain
   * INERT (pulling hotspot no. 1 would move a draft point that is not visible), and arming the tool RELEASES
   * them. Arming means wanting to place one's own points, and since a view movement no longer erases them,
   * nothing else gives way to them.
   */
  const showingDraft = ann.viewedPoi.length === 0;
  // The callbacks change at each render (the list of points moves): replaying them through a ref avoids
  // reinstalling the listeners in the middle of a gesture.
  const live = useRef({ poi, onExit, t });
  useEffect(() => {
    live.current = { poi, onExit, t };
  });

  useEffect(() => {
    if (armed && !showingDraft) setViewedPoi([]);
  }, [armed, showingDraft, setViewedPoi]);

  // Hotspots manipulable as long as a draft point is on screen; inert otherwise (reading).
  const editable = showingDraft && poi.points.length > 0;
  useEffect(() => {
    if (!ready) return;
    if (!editable) {
      setPoiHandlers(null);
      return;
    }
    const handlers: MarkerHandlers = {
      onMove: (index, clientX, clientY) => {
        const hotspot = hotspotAtPointer(clientX, clientY);
        if (!hotspot) toast.error(live.current.t('poi.noSurface'));
        else live.current.poi.move(index, hotspot);
      },
      onSelect: (index) => {
        const point = live.current.poi.points[index];
        if (point) live.current.poi.setActiveKey(point.key);
      },
      label: (index) => live.current.t('poi.pointLabel', { n: index + 1 }),
    };
    setPoiHandlers(handlers);
    return () => setPoiHandlers(null);
  }, [ready, editable, hotspotAtPointer, setPoiHandlers]);

  // Put-forward rank: the scene and the composer row signal the same point.
  const activeIndex = poi.points.findIndex((p) => p.key === poi.activeKey);
  useEffect(() => {
    setPoiActive(activeIndex >= 0 ? activeIndex : null);
  }, [activeIndex, setPoiActive]);

  useEffect(() => {
    if (!armed || !ready) return;
    const dom = getSceneHandle()?.dom;
    if (!dom) return;
    const previousCursor = dom.style.cursor;
    dom.style.cursor = 'crosshair';
    let down: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      // Still left click only: a drag remains an orbit.
      if (e.button !== 0 || !start || !isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      const hotspot = hotspotAtPointer(e.clientX, e.clientY);
      if (!hotspot) {
        toast.error(live.current.t('poi.noSurface'));
        return;
      }
      live.current.poi.add(hotspot);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') live.current.onExit();
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      dom.style.cursor = previousCursor;
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [armed, ready, getSceneHandle, hotspotAtPointer]);
}
