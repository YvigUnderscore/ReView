// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import { UNDO_PRIORITY, useUndoScope } from '@/v2/lib/undoScope';
import { useUndoToast } from '@/v2/lib/useUndoToast';
import { useT } from '@/v2/i18n';
import type { SplatPaintStroke } from '../../reviewTypes';
import type { SceneViewer } from '../../viewer/sceneHandle';
import { loadLineModules, type LineModules } from './lineModules';
import { DEFAULT_STROKE_PX, buildStrokeLine, decodeStrokes, disposeStrokeLine } from './strokes';
import { makeProjector, paintHandle, type PaintSceneHandle, type Viewport } from './surfaceRay';
import { pickStroke } from './surfaceTrace';
import { useStrokeGesture } from './useStrokeGesture';

/**
 * 3D surface brush of the review: strokes painted on the surface of the scene, stored in
 * **object space** and attached to the comment being written (`annotation` array, like the
 * hotspot): non-destructive, visible to everyone, and following the media transform.
 *
 * It serves the **two spatial types** since lot 13: the hook no longer receives the splat viewer
 * but a `SceneViewer` (`viewer/sceneHandle`), which the 3D model fills too. The file name and the
 * hook name stayed: the part type stored in comments is `splat-paint`, and renaming one without
 * being able to rename the other would only have added one more name for the same thing.
 *
 * This hook holds the state and persistence; the gesture lives in `useStrokeGesture`, the geometry
 * in `surfaceTrace`, the rendering in `strokes`/`strokeFrame`, the ray in `surfaceRay`: the only
 * place that still knows that a cloud and a mesh do not raycast the same way.
 *
 * The eraser is the brush's second tool (`armed === 'erase'`): it removes a stroke being prepared
 * and, if the viewer is the author of the consulted comment, a stroke already sent, by rewriting
 * the list of parts of its annotation. Until now the only way to undo a stroke was to erase
 * everything before sending.
 */
export type PaintTool = 'paint' | 'erase';

/** Displayed stroke: the stroke, its 3D line, and its place in the comment's annotation. */
interface ShownStroke {
  stroke: SplatPaintStroke;
  line: Line2;
  partIndex: number;
}

export function useSplatPaint(viewer: SceneViewer, spatial: boolean, mediaId: number) {
  const { getSceneHandle: sceneHandle, ready } = viewer;
  // **Paintable** handle: the common handle makes `mesh` optional, but the brush needs it.
  const getSceneHandle = useCallback(
    (): PaintSceneHandle | null => paintHandle(sceneHandle()),
    [sceneHandle],
  );
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
  const [armed, setArmed] = useState<PaintTool | null>(null);
  const [color, setColor] = useState('#ff4d4d');
  const [width, setWidth] = useState(DEFAULT_STROKE_PX);
  const [pendingCount, setPendingCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [lines, setLines] = useState<LineModules | null>(null);
  // Consulted comment: its raw annotation (to rewrite the list of parts) and its identifier,
  // non-null **only if the viewer is its author**: this is what the server allows rewriting, and
  // the eraser must not promise more.
  const [viewed, setViewed] = useState<{ annotation: unknown; commentId: number | null }>({
    annotation: null,
    commentId: null,
  });
  const pendingRef = useRef<{ stroke: SplatPaintStroke; line: Line2 }[]>([]);
  // Strokes undone, awaiting redo. Only the stroke DATA is kept: its Three line was released on
  // undoing (`disposeStrokeLine` frees its geometry), so it is rebuilt on redo, since a released
  // object does not go back into the scene.
  const undoneRef = useRef<SplatPaintStroke[]>([]);
  const shownRef = useRef<ShownStroke[]>([]);
  // Mirrors read from the handlers (never during render: react-hooks/refs rule).
  const viewedRef = useRef(viewed);
  const linesRef = useRef<LineModules | null>(null);
  useEffect(() => {
    viewedRef.current = viewed;
    linesRef.current = lines;
  }, [viewed, lines]);

  /*
   * `Line2` classes imported as soon as the scene is MOUNTED: everything else is then synchronous.
   *
   * Waiting for `ready` is not a stylistic precaution: before it, there is neither surface to paint
   * nor stroke to display, and the import ran concurrently with the viewer's loading, which has many
   * other modules to fetch. The import failure is caught here: the promise of an `import()` that
   * rejects without a `catch` surfaces as an uncaught rejection, and the brush then simply does not
   * paint (the options bar stays, it just writes nothing).
   */
  useEffect(() => {
    if (!spatial || !ready) return;
    let cancelled = false;
    void loadLineModules().then(
      (loaded) => {
        if (!cancelled) setLines(loaded);
      },
      () => {
        if (!cancelled) toast.error(t('review.brush.unavailable'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [spatial, ready, t]);

  /** Builds and mounts strokes in the scene, without touching the undo stack. */
  const attachStrokes = useCallback(
    (strokes: SplatPaintStroke[]) => {
      const handle = getSceneHandle();
      const modules = linesRef.current;
      if (!handle || !modules) return;
      for (const stroke of strokes) {
        const line = buildStrokeLine(handle, modules, stroke);
        handle.mesh.add(line);
        pendingRef.current.push({ stroke, line });
      }
      setPendingCount(pendingRef.current.length);
    },
    [getSceneHandle],
  );

  /** Lays the strokes of a gesture (a gesture cut by a hole yields several). */
  const addStrokes = useCallback(
    (strokes: SplatPaintStroke[]) => {
      attachStrokes(strokes);
      // A new stroke makes the future unreachable: the rule of any history stack.
      undoneRef.current = [];
      setRedoCount(0);
    },
    [attachStrokes],
  );

  const getLines = useCallback(() => linesRef.current, []);
  const gesture = useStrokeGesture({ getSceneHandle, getLines, color, width, onStrokes: addStrokes });
  const { cancel: cancelGesture } = gesture;

  // Disarming the brush abandons the preview in progress: no gesture carries it any more.
  useEffect(() => {
    if (armed !== 'paint') cancelGesture();
  }, [armed, cancelGesture]);

  /** Undoes the last stroke of the composer. */
  const undoStroke = useCallback(() => {
    const last = pendingRef.current.pop();
    if (!last) return;
    disposeStrokeLine(last.line);
    undoneRef.current.push(last.stroke);
    setPendingCount(pendingRef.current.length);
    setRedoCount(undoneRef.current.length);
  }, []);

  /** Redoes the last undone stroke: there was no way to go back on a Ctrl+Z before. */
  const redoStroke = useCallback(() => {
    const stroke = undoneRef.current.pop();
    if (!stroke) return;
    attachStrokes([stroke]);
    setRedoCount(undoneRef.current.length);
  }, [attachStrokes]);

  /** Removes all strokes from the composer (after sending the comment, or abandoning it). */
  const clearPending = useCallback(() => {
    for (const p of pendingRef.current) disposeStrokeLine(p.line);
    pendingRef.current = [];
    undoneRef.current = [];
    setPendingCount(0);
    setRedoCount(0);
  }, []);

  /**
   * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on the strokes being prepared.
   *
   * The "undo last stroke" button of the options bar was the brush's only way back, and it had no
   * counterpart. Strokes being prepared are PURELY LOCAL: they leave with the comment and nothing is
   * yet on the server, so a real history, hence a real Ctrl+Z, promises nothing that cannot be kept.
   *
   * The scope stays registered as long as a stroke is being prepared, even with the brush disarmed:
   * one often disarms before re-reading. It comes before the splat editor, which listens to the same
   * keys (`lib/undoScope`), and is removed as soon as it has nothing left to restore.
   */
  useUndoScope({
    enabled: spatial && (armed !== null || pendingCount > 0 || redoCount > 0),
    priority: UNDO_PRIORITY.brush3d,
    canUndo: pendingCount > 0,
    canRedo: redoCount > 0,
    undo: undoStroke,
    redo: redoStroke,
  });

  /** Comment parts to attach to the comment being sent. */
  const serializePending = useCallback((): SplatPaintStroke[] => {
    return pendingRef.current.map((p) => p.stroke);
  }, []);

  /**
   * Shows the strokes of the selected comment (null annotation = hide). `commentId` is only passed
   * if the viewer can rewrite this comment: it then opens the eraser on its strokes.
   */
  const showFromAnnotation = useCallback((annotation: unknown, commentId: number | null = null) => {
    setViewed((prev) =>
      prev.annotation === annotation && prev.commentId === commentId ? prev : { annotation, commentId },
    );
  }, []);

  // Renders the strokes of the consulted comment. The part index is kept stroke by stroke: it is
  // what allows removing one without touching the others (points, camera animation).
  useEffect(() => {
    for (const shown of shownRef.current) disposeStrokeLine(shown.line);
    shownRef.current = [];
    const handle = getSceneHandle();
    if (!handle || !lines) return;
    const parts = Array.isArray(viewed.annotation) ? viewed.annotation : [];
    parts.forEach((part, partIndex) => {
      const [stroke] = decodeStrokes([part]);
      if (!stroke) return;
      const line = buildStrokeLine(handle, lines, stroke);
      handle.mesh.add(line);
      shownRef.current.push({ stroke, line, partIndex });
    });
  }, [viewed, lines, getSceneHandle]);

  /**
   * Removes a stroke from a comment already sent (author only, server-side too).
   *
   * No Ctrl+Z here: the stroke has **left**, it is in the comment others read, and erasing it
   * rewrites the list of parts on the server side. The undo is therefore offered in the toast, and
   * only promises that one: the previous list is kept, nothing more. A local history on already
   * shared data would lie at the first reload.
   */
  const eraseSent = useCallback(
    async (commentId: number, annotation: unknown, partIndex: number) => {
      const parts = Array.isArray(annotation) ? annotation : [];
      const next = parts.filter((_, index) => index !== partIndex);
      /** Sets a list of parts and refreshes the thread. Its failure is propagated. */
      const writeParts = async (value: unknown[]): Promise<void> => {
        await api.patch(`/api/comments/${commentId}`, { annotation: value });
        setViewed({ annotation: value, commentId });
        await qc.invalidateQueries({ queryKey: qk.comments(mediaId) });
      };
      try {
        await writeParts(next);
        done(t('review.splat.strokeErased'), () => writeParts(parts));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('review.splat.strokeEraseFailed'));
      }
    },
    [qc, mediaId, t, done],
  );

  /** Erases on click: the closest stroke being prepared, otherwise the one of the consulted comment. */
  const eraseAt = useCallback(
    (point: [number, number], viewport: Viewport) => {
      const handle = getSceneHandle();
      if (!handle) return;
      const project = makeProjector(handle, viewport);
      const pending = pickStroke(
        pendingRef.current.map((p) => p.stroke),
        point,
        project,
      );
      if (pending !== null) {
        disposeStrokeLine(pendingRef.current[pending].line);
        pendingRef.current.splice(pending, 1);
        setPendingCount(pendingRef.current.length);
        return;
      }
      const shown = pickStroke(
        shownRef.current.map((s) => s.stroke),
        point,
        project,
      );
      if (shown === null) return;
      const { commentId, annotation } = viewedRef.current;
      if (commentId === null) {
        toast.error(t('review.splat.strokeNotYours'));
        return;
      }
      void eraseSent(commentId, annotation, shownRef.current[shown].partIndex);
    },
    [getSceneHandle, eraseSent, t],
  );

  // Cleanup on unmount (the page remounts per media: the scene disappears with its lines).
  useEffect(
    () => () => {
      for (const p of pendingRef.current) disposeStrokeLine(p.line);
      pendingRef.current = [];
      for (const shown of shownRef.current) disposeStrokeLine(shown.line);
      shownRef.current = [];
    },
    [],
  );

  return {
    /** Brush tool armed by the rail (null: none, the overlay is not mounted). */
    armed: spatial ? armed : null,
    setArmed,
    color,
    setColor,
    width,
    setWidth,
    pendingCount,
    /** Undone strokes, restorable (greys out the "redo" button). */
    redoCount,
    gesture,
    eraseAt,
    undoStroke,
    redoStroke,
    clearPending,
    serializePending,
    showFromAnnotation,
  };
}

export type SplatPaintState = ReturnType<typeof useSplatPaint>;
