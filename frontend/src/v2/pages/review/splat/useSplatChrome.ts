// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import type { ChromeState } from '../chrome/chromeState';
import type { ToolId } from '../chrome/tools';
import type { EditorTool } from './editor/useSplatEditor';
import type { SplatEditorState } from './editor/useSplatEditor';
import type { SplatPaintState } from './paint/useSplatPaint';

/** Maps a rail choice to a splat editor tool. Everything else leaves the editor at rest. */
const EDITOR_TOOL: Partial<Record<ToolId, EditorTool>> = {
  'sel-rect': 'select-rect',
  'sel-lasso': 'select-lasso',
  'sel-brush': 'brush',
  translate: 'translate',
  rotate: 'rotate',
  scale: 'scale',
};

/**
 * Makes the tool armed on the rail follow the hooks that actually carry the gesture: the editor
 * (selection, gizmos), the 3D painter and focus-on-click. The rail is the only source of truth
 * for the current tool: the hooks no longer drive their own bar.
 */
export function useSplatChrome({
  state,
  editor,
  paint,
  focusPick,
  onToggleFocusPick,
  cameraRig,
}: {
  state: ChromeState;
  editor: SplatEditorState;
  paint: SplatPaintState;
  focusPick: boolean;
  onToggleFocusPick: () => void;
  /** Gizmo of the layout mode's camera-object (staging). */
  cameraRig?: { mode: 'translate' | 'rotate'; setMode: (m: 'translate' | 'rotate') => void };
}) {
  const tool = state.tool;
  const { setTool } = editor;
  const { setArmed } = paint;

  useEffect(() => {
    setTool(EDITOR_TOOL[tool] ?? 'navigate');
  }, [tool, setTool]);

  // The surface brush and the stroke eraser share the same overlay: the rail says which of the two
  // is armed, and the painting hook deduces what the click does.
  useEffect(() => {
    setArmed(tool === 'paint' ? 'paint' : tool === 'paint-erase' ? 'erase' : null);
  }, [tool, setArmed]);

  // Focus-on-click is a mode of the camera rig: it is armed and disarmed with the tool.
  useEffect(() => {
    if ((tool === 'focus') !== focusPick) onToggleFocusPick();
  }, [tool, focusPick, onToggleFocusPick]);

  useEffect(() => {
    if (!cameraRig) return;
    if (tool === 'cam-move') cameraRig.setMode('translate');
    else if (tool === 'cam-aim') cameraRig.setMode('rotate');
  }, [tool, cameraRig]);
}
