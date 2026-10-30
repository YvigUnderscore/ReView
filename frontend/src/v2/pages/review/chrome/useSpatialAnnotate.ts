// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type { Annotations } from '../useAnnotations';
import type { ChromeState } from './chromeState';
import type { ToolId } from './tools';

/**
 * Composer "Annotate" button ↔ rail "Annotate" mode, for **spatial viewers**.
 *
 * Flat media have had this bridge since Phase 50 (`useMediaChrome`); the 3D model and the splat
 * did not. The consequence, observed by the user: clicking "Annotate" on a scene only armed the 2D
 * drawing layer, with its pencil and nothing else — the rail stayed in exploration, and the
 * scene's annotation tools (surface brush, stroke eraser, point of interest) as well as their
 * settings appeared nowhere.
 *
 * Three rules, each on an EDGE and not on a state — two effects reacting to the state would
 * contradict each other on every render, one relighting what the other has just turned off:
 *
 *  1. **The button arms the mode** (rising edge of `annotating`). Its falling edge does not change
 *     the mode: putting the pencil away is not leaving annotation, and that is precisely what
 *     rule 3 does.
 *  2. **Leaving the mode turns the button off** (falling edge of the "Annotate" mode): it does not
 *     stay lit on an annotation one has just left.
 *  3. **A scene tool takes back the pointer.** The 2D layer covers the whole frame (`z-[6]`) and,
 *     when armed, captures the pointer: it swallowed the clicks meant for the surface — this is what
 *     made placing a point of interest inert as soon as "Annotate" had been clicked. Arming the
 *     brush, the eraser or the pin therefore stows the 2D pencil, which remains what the idle tool
 *     leaves on screen.
 */

/** Tools whose gesture targets the SCENE: they cannot share the pointer with the 2D layer. */
const SCENE_POINTER_TOOLS = new Set<ToolId>(['paint', 'paint-erase', 'pin']);

export function useSpatialAnnotate({
  state,
  update,
  ann,
}: {
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  ann: Annotations;
}): void {
  const { annotating, setAnnotating } = ann;
  const annotateMode = state.mode === 'annotate';
  const tool = state.tool;

  const wasAnnotating = useRef(annotating);
  useEffect(() => {
    if (annotating === wasAnnotating.current) return;
    wasAnnotating.current = annotating;
    if (annotating) update({ mode: 'annotate' });
  }, [annotating, update]);

  const wasAnnotateMode = useRef(annotateMode);
  useEffect(() => {
    if (annotateMode === wasAnnotateMode.current) return;
    wasAnnotateMode.current = annotateMode;
    if (!annotateMode) setAnnotating(false);
  }, [annotateMode, setAnnotating]);

  useEffect(() => {
    if (annotating && SCENE_POINTER_TOOLS.has(tool)) setAnnotating(false);
  }, [annotating, tool, setAnnotating]);
}
