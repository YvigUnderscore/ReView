// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import type { MarkerHandlers } from '../three/objectHotspot';
import type { Hotspot3D } from '../reviewTypes';
import { useAnnotations, type Annotations } from '../useAnnotations';
import type { PoiDraftState } from './usePoiDraft';
import { usePoiPlacement, type PoiViewer } from './usePoiPlacement';

/**
 * 3D / splat parity: the two viewers fulfil THE SAME contract (`PoiViewer`) and go through THE SAME hook.
 * The two stubs therefore differ only by their name and by the way they answer the ray: exactly what
 * distinguishes them in reality (triangles on one side, a cloud on the other).
 */
function viewerStub(name: string) {
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  // The splat renders a point in object space, and so does the 3D model: that is the replay rule for
  // everyone. The stub encodes the pointer position so that the test can recognise it.
  const pick = vi.fn((x: number, y: number): Hotspot3D | null =>
    x < 0 ? null : { position: `${x} ${y} 0`, normal: '0 0 1', space: 'object' },
  );
  let handlers: MarkerHandlers | null = null;
  const active: (number | null)[] = [];
  const viewer: PoiViewer = {
    ready: true,
    getSceneHandle: () => ({ dom }),
    hotspotAtPointer: pick,
    setPoiHandlers: (h) => {
      handlers = h;
    },
    setPoiActive: (i) => active.push(i),
  };
  return { name, dom, pick, viewer, active, markerHandlers: () => handlers };
}

/**
 * The hook takes the WHOLE composer (`ann`), not only the draft: it is what knows that the hotspots on
 * screen are those of a reviewed comment, and what releases them when the tool is armed. The harness
 * therefore mounts the real `useAnnotations`: the two viewers derived nothing else from it.
 */
function mount(stub: ReturnType<typeof viewerStub>, armed = true) {
  const onExit = vi.fn();
  const hook = renderHook(
    ({ isArmed }: { isArmed: boolean }) => {
      const ann = useAnnotations();
      usePoiPlacement({ viewer: stub.viewer, armed: isArmed, ann, onExit });
      return ann;
    },
    { initialProps: { isArmed: armed } },
  );
  const ann = (): Annotations => hook.result.current;
  return { hook, onExit, ann, poi: (): PoiDraftState => hook.result.current.poi };
}

/** Point as a reviewed comment displays it: the scene's hotspots are then its own. */
const viewedPoint: Hotspot3D = { position: '5 5 0', normal: '0 0 1', space: 'object' };

/** Still left click in the view: the gesture that places a point. */
function clickAt(dom: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(dom, { button: 0, clientX: x, clientY: y });
  fireEvent.pointerUp(dom, { button: 0, clientX: x, clientY: y });
}

describe.each([viewerStub('modèle 3D'), viewerStub('splat')])(
  'usePoiPlacement — $name : armer l’outil, c’est être en placement',
  (stub) => {
    it('a click in the view places a point, without an intermediate button', () => {
      const { poi } = mount(stub);
      expect(poi().points).toHaveLength(0);
      act(() => clickAt(stub.dom, 40, 60));
      expect(stub.pick).toHaveBeenCalledWith(40, 60);
      expect(poi().points).toHaveLength(1);
      expect(poi().points[0].position).toBe('40 60 0');
      // Object space: the point is replayed for every viewer, transformation included.
      expect(poi().points[0].space).toBe('object');
    });

    it('several points in one drafting gesture, numbered in placement order', () => {
      const { poi } = mount(stub);
      act(() => clickAt(stub.dom, 10, 10));
      act(() => clickAt(stub.dom, 20, 20));
      act(() => clickAt(stub.dom, 30, 30));
      expect(poi().points.map((p) => p.position)).toEqual(['10 10 0', '20 20 0', '30 30 0']);
      // The last one placed is the one being edited, and the scene signals it at the same rank.
      expect(poi().activeKey).toBe(poi().points[2].key);
    });

    it('places nothing on a click in the void, and a drag remains an orbit', () => {
      const { poi } = mount(stub);
      act(() => clickAt(stub.dom, -1, -1));
      expect(poi().points).toHaveLength(0);
      act(() => {
        fireEvent.pointerDown(stub.dom, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.pointerUp(stub.dom, { button: 0, clientX: 120, clientY: 90 });
      });
      expect(poi().points).toHaveLength(0);
    });

    it('tool at rest: a click no longer places anything', () => {
      const { poi, hook } = mount(stub, false);
      act(() => clickAt(stub.dom, 15, 15));
      expect(poi().points).toHaveLength(0);
      hook.rerender({ isArmed: true });
      act(() => clickAt(stub.dom, 15, 15));
      expect(poi().points).toHaveLength(1);
    });

    it('arming the tool returns the screen to the draft: the reviewed points are released', () => {
      const { ann, hook } = mount(stub, false);
      act(() => ann().setViewedPoi([viewedPoint]));
      expect(ann().viewedPoi).toHaveLength(1);
      // The tool is armed while a comment is on screen: its points give way, otherwise we would place
      // points without seeing them (the hotspots displayed would be its own). A view movement no longer
      // erases them: nothing else gives way to them.
      hook.rerender({ isArmed: true });
      expect(ann().viewedPoi).toEqual([]);
    });

    it('Escape returns the tool to rest on the rail', () => {
      const { onExit } = mount(stub);
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('hotspots only become manipulable with a point in preparation', () => {
      const { poi } = mount(stub);
      expect(stub.markerHandlers()).toBeNull();
      act(() => clickAt(stub.dom, 12, 12));
      expect(stub.markerHandlers()).not.toBeNull();
      // Pulled elsewhere, the hotspot puts its point back; clicked, it designates it.
      act(() => stub.markerHandlers()!.onMove(0, 90, 70));
      expect(poi().points[0].position).toBe('90 70 0');
      act(() => poi().setActiveKey(null));
      act(() => stub.markerHandlers()!.onSelect(0));
      expect(poi().activeKey).toBe(poi().points[0].key);
      // The rank put forward is published to the scene: the row and the hotspot say the same point.
      expect(stub.active.at(-1)).toBe(0);
    });

    it('the hotspots of a REVIEWED comment remain inert, draft or not', () => {
      // Rewritten for the new contract: the `showingDraft` flag is no longer passed by the viewer; the hook
      // derives it from `ann.viewedPoi`. The tool stays at rest here, otherwise arming it would release
      // precisely these points: that is the next test.
      const { poi, ann } = mount(stub, false);
      act(() => ann().setViewedPoi([viewedPoint]));
      act(() => poi().add({ position: '1 1 0', normal: '0 0 1', space: 'object' }));
      expect(poi().points).toHaveLength(1);
      // These are the points of the selected comment that are on screen: pulling hotspot no. 1 would move
      // a draft point that one does not see.
      expect(stub.markerHandlers()).toBeNull();
    });

    it('a point is deleted as long as the comment is not sent', () => {
      const { poi } = mount(stub);
      act(() => clickAt(stub.dom, 1, 1));
      act(() => clickAt(stub.dom, 2, 2));
      act(() => poi().remove(poi().points[0].key));
      expect(poi().points.map((p) => p.position)).toEqual(['2 2 0']);
      act(() => poi().clear());
      expect(poi().points).toHaveLength(0);
      expect(stub.markerHandlers()).toBeNull();
    });
  },
);
