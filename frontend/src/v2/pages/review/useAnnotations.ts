// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, useState } from 'react';
import type { Shape, Tool } from '../../components/AnnotationCanvas';
import {
  EMPTY_HISTORY,
  pushStep,
  redoStep,
  undoStep,
  type AnnotationHistory,
  type AnnotationSnapshot,
} from './annotationHistory';
import { NO_BANDS, pastedRefBox, placeRefBox, type StagedReference, type ViewerBands } from './referenceBox';
import { useAnnotationShortcuts } from './useAnnotationShortcuts';
import type { SplatLayoutAnim } from './reviewTypes';
import type { SplatEditDraft, SplatEditProposal } from './splat/splatEditPart';
import { usePoiDraft } from './poi/usePoiDraft';
import type { PoiPoint } from './poi/poiPoints';

/**
 * Annotation state of the composer (2D drawing, 3D points of interest, pasted references) and of the
 * annotation of a selected comment, read-only (`viewed*`).
 *
 * A single history covers the drawing and the references, from the keyboard as well as from the buttons.
 * `defaultColor` (the assigned color) stays active as long as no color is picked by hand.
 */
export function useAnnotations(opts?: {
  defaultColor?: string;
  onColorChange?: (c: string) => void;
  /** Initial shapes of the composer (lazy initializer — local draft 32.C). */
  initialShapes?: () => Shape[];
}) {
  const [tool, setToolState] = useState<Tool>('draw');
  // Drawing tool from before the reference was armed: going back to it is the exit from placing mode.
  const drawTool = useRef<Tool>('draw');
  // Stable identity: the rail re-arms its tool in an effect that depends on `setTool` — a new
  // `setTool` on every render would immediately overwrite the just-set `ref`.
  const setTool = useCallback((next: Tool) => {
    if (next !== 'ref') drawTool.current = next;
    setToolState(next);
  }, []);
  const exitRefTool = useCallback(() => setTool(drawTool.current), [setTool]);
  // Manual choice takes precedence; otherwise the default color (preference/id), reloaded without an effect.
  const [manualColor, setManualColor] = useState<string | null>(null);
  const color = manualColor ?? opts?.defaultColor ?? '#ef4444';
  const setColor = (c: string) => {
    setManualColor(c);
    opts?.onColorChange?.(c);
  };
  const [alpha, setAlpha] = useState(1);
  const [penWidth, setPenWidth] = useState(3);
  const [annot, setAnnot] = useState<Shape[]>(opts?.initialShapes ?? []);
  const [hist, setHist] = useState<AnnotationHistory>(EMPTY_HISTORY);
  // Gesture in progress: all the changes that carry it fit in a single step.
  const step = useRef<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  // Points of interest of the comment in progress: placed by clicking in the viewer, numbered in the
  // order of placement, movable and removable as long as nothing is sent (Phase 50, batch 12).
  const poi = usePoiDraft();
  // Reference images in preparation: placed/movable as long as the comment is not sent, then frozen
  // server-side (linked to the created comment).
  const [stagedRefs, setStagedRefs] = useState<StagedReference[]>([]);
  // Free bands around the media, published by the references layer (the only one that knows the
  // viewer's geometry). They are now only used to choose where a paste lands — moving, for its part,
  // is no longer bounded. In a `ref`: read at paste time, and a re-measurement must not trigger a
  // render of the composer.
  const refBands = useRef<ViewerBands>(NO_BANDS);
  const setRefBands = useCallback((bands: ViewerBands) => {
    refBands.current = bands;
  }, []);
  const snapshot = (): AnnotationSnapshot => ({ shapes: annot, refs: stagedRefs });
  // A complete gesture = one step. As long as the same `stepKey` comes back (a drag, a hundred
  // `pointermove`s), the history does not open a second one.
  const openStep = (stepKey?: string) => {
    if (stepKey && stepKey === step.current) return;
    step.current = stepKey ?? null;
    setHist((h) => pushStep(h, snapshot()));
  };
  const addStagedRef = (dataUrl: string) => {
    openStep();
    setStagedRefs((rs) => [
      ...rs,
      {
        key: Math.random().toString(36).slice(2, 9),
        dataUrl,
        ...pastedRefBox(rs.length, refBands.current),
      },
    ]);
    // Pasting leaves the drawing and arms the reference's move: we have just placed it, the next
    // gesture is to position it.
    setTool('ref');
  };
  const updateStagedRef = (
    key: string,
    patch: Partial<Pick<StagedReference, 'x' | 'y' | 'width'>>,
    stepKey?: string,
  ) => {
    openStep(stepKey);
    // The reference lands where the pointer drops it, inside as well as outside the media's frame: no
    // band enters here, only the ceiling shared with the server bounds the gesture.
    setStagedRefs((rs) => rs.map((r) => (r.key === key ? { ...r, ...placeRefBox({ ...r, ...patch }) } : r)));
  };
  const removeStagedRef = (key: string) => {
    openStep();
    setStagedRefs((rs) => rs.filter((r) => r.key !== key));
  };

  // Camera animation attached to the comment in progress (layout mode) — staged before sending.
  const [cameraAnim, setCameraAnim] = useState<SplatLayoutAnim | null>(null);
  // Annotation of a selected comment (read-only)
  const [viewed, setViewed] = useState<Shape[] | null>(null);
  // Points of interest of the selected comment — numbered dots, inert (read-only).
  const [viewedPoi, setViewedPoi] = useState<PoiPoint[]>([]);
  const [viewedAspect, setViewedAspect] = useState<number | null>(null);
  // Camera animation of the selected comment — replayed by the viewer.
  const [viewedCameraAnim, setViewedCameraAnim] = useState<SplatLayoutAnim | null>(null);
  // 3D scene proposal of the selected comment (46.D) — never global.
  const [viewedSceneOverride, setViewedSceneOverride] = useState<unknown>(null);
  // Scene modifications in progress, attached to the next comment sent (like the points of interest
  // and the camera animation).
  const [sceneOverride, setSceneOverride] = useState<unknown>(null);
  // Point-cloud edit proposal of the selected comment: same mechanism as the 3D scene above, for the
  // other spatial viewer (Phase 50, batch 14).
  const [viewedSplatEdit, setViewedSplatEdit] = useState<SplatEditProposal | null>(null);
  /**
   * The one being drafted, on the other hand, is NOT a state: the splat editor provides it on demand,
   * at the moment of sending.
   *
   * A deletion mask weighs up to a few hundred kilobytes of binary; encoding it on every render of
   * the editor to put it in a state — and compare it to avoid the render loop — would be costly for a
   * value that a single caller reads, once. `sent` hands control back to the editor when the comment
   * has left.
   */
  const splatEditSource = useRef<{ build: () => SplatEditDraft | null; sent: () => void } | null>(null);
  const provideSplatEdit = useCallback((source: typeof splatEditSource.current) => {
    splatEditSource.current = source;
  }, []);
  const takeSplatEdit = useCallback(() => splatEditSource.current?.build() ?? null, []);

  /** `stepKey`: same value over a whole gesture (dragging a shape) = a single step. */
  const setShapes = (next: Shape[], stepKey?: string) => {
    openStep(stepKey);
    setAnnot(next);
  };
  const apply = (move: ReturnType<typeof undoStep>) => {
    if (!move) return;
    step.current = null;
    setHist(move.history);
    setAnnot(move.snapshot.shapes);
    setStagedRefs(move.snapshot.refs);
  };
  const undo = () => apply(undoStep(hist, snapshot()));
  const redo = () => apply(redoStep(hist, snapshot()));
  const clear = () => setShapes([]);
  const canUndo = hist.past.length > 0;
  const canRedo = hist.future.length > 0;
  // The composer is in the reader's hands as soon as they annotate or have pasted: it is there, and
  // there only, that Ctrl+Z targets the annotation rather than the media's editor.
  useAnnotationShortcuts({
    enabled: annotating || stagedRefs.length > 0,
    canUndo,
    canRedo,
    undo,
    redo,
  });

  /** Resets the composer (after the comment is sent). */
  const resetComposer = () => {
    setAnnot([]);
    setHist(EMPTY_HISTORY);
    step.current = null;
    setTool(drawTool.current);
    poi.clear();
    setCameraAnim(null);
    // The scene proposal left with the comment: like the points, it must not re-attach itself to the
    // next comment (46.T).
    setSceneOverride(null);
    // The point-cloud edit that just left the editor now lives in the comment, and must not re-attach
    // itself to the next one (46.T) — nor upload its mask a second time. It is the 3D model's
    // mechanism, to the letter.
    splatEditSource.current?.sent();
    setStagedRefs([]);
    setAnnotating(false);
  };

  /**
   * Releases EVERYTHING the selected comment showed — drawing, points of interest, capture ratio,
   * camera animation, scene proposal.
   *
   * This is the **explicit** exit from reading (viewer pill, Escape, another comment, entering
   * drafting), and only that. A view movement no longer goes through here: it only hides the 2D
   * drawing, the only thing drawn in the screen's plane — the points of interest, brush strokes and
   * proposed scene are anchored in the scene and stay displayed while navigating (hence the removal
   * of the `keepScene` flag, which only protected the scene).
   */
  const clearViewed = () => {
    setViewed(null);
    setViewedPoi([]);
    setViewedAspect(null);
    setViewedCameraAnim(null);
    setViewedSceneOverride(null);
    setViewedSplatEdit(null);
  };

  return {
    tool,
    setTool,
    exitRefTool,
    color,
    setColor,
    alpha,
    setAlpha,
    penWidth,
    setPenWidth,
    annot,
    setShapes,
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
    annotating,
    setAnnotating,
    poi,
    cameraAnim,
    setCameraAnim,
    stagedRefs,
    addStagedRef,
    updateStagedRef,
    removeStagedRef,
    setRefBands,
    viewed,
    setViewed,
    viewedPoi,
    setViewedPoi,
    viewedAspect,
    setViewedAspect,
    viewedCameraAnim,
    setViewedCameraAnim,
    viewedSceneOverride,
    setViewedSceneOverride,
    sceneOverride,
    setSceneOverride,
    viewedSplatEdit,
    setViewedSplatEdit,
    provideSplatEdit,
    takeSplatEdit,
    resetComposer,
    clearViewed,
  };
}

export type Annotations = ReturnType<typeof useAnnotations>;
