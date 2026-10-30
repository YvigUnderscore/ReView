// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type { Tool } from '../../components/AnnotationCanvas';
import type { ChromeState } from './chrome/chromeState';
import { DEFAULT_MODE } from './chrome/modes';
import type { ToolId } from './chrome/tools';
import type { Annotations } from './useAnnotations';

/**
 * The two lists of hidden tools have disappeared (Phase 50): they only filtered the rail — the letter
 * still armed the tool anyway — and only contained the "Zoom" tool, removed for lack of an
 * implementation. Zoom on flat viewers is a permanent gesture, not a tool.
 *
 * Translation rail → annotation canvas tool.
 */
const ANNOTATION_TOOL: Partial<Record<ToolId, Tool>> = {
  draw: 'draw',
  rect: 'rect',
  ellipse: 'ellipse',
  arrow: 'arrow',
  polygon: 'polygon',
  text: 'text',
  'shape-move': 'move',
  erase: 'erase',
};

/**
 * Makes the annotation follow the rail: entering "Annotate" mode arms the canvas, leaving it disarms
 * it, and the chosen tool becomes the drawing tool. The strokes themselves remain managed by
 * `useAnnotations` — only the palette bar disappears, replaced by the rail and the options.
 */
export function useMediaChrome({
  state,
  update,
  ann,
}: {
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  ann: Annotations;
}) {
  const { setTool, setAnnotating, annotating } = ann;
  const annotateMode = state.mode === 'annotate';
  const tool = ANNOTATION_TOOL[state.tool];

  useEffect(() => {
    setAnnotating(annotateMode);
  }, [annotateMode, setAnnotating]);

  // The composer's "Annotate" button (and the right click) arm the annotation without going through
  // the toggle — the chrome follows, in both directions: entering shows the drawing tools on the rail,
  // leaving returns to idle. Triggered by the **toggle** of `annotating` only, so as not to re-impose
  // the mode when the user picks another one (that choice disarms the annotation via the effect above,
  // not the reverse).
  const wasAnnotating = useRef(annotating);
  useEffect(() => {
    if (annotating === wasAnnotating.current) return;
    wasAnnotating.current = annotating;
    if (annotating) update({ mode: 'annotate' });
    else if (state.mode === 'annotate') update({ mode: DEFAULT_MODE });
  }, [annotating, state.mode, update]);

  useEffect(() => {
    if (tool) setTool(tool);
  }, [tool, setTool]);
}
