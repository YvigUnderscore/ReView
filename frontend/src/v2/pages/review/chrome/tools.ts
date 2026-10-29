// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BoxSelect,
  Brush,
  Circle,
  Crosshair,
  Eraser,
  Frame,
  Hand,
  Hexagon,
  Home,
  Lasso,
  Maximize2,
  MapPin,
  Move,
  Move3d,
  MoveUpRight,
  Pencil,
  Rotate3d,
  Scale3d,
  Scan,
  SprayCan,
  Square,
  SquareDashed,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { MediaKind } from '../../../types/api';
import type { MessageKey } from '../../../i18n';
import { isSpatialKind, modesFor, type ModeId } from './modes';

/**
 * Tool rail — the **exclusive** pointing tools of the active mode: only one is armed at a time, and
 * it decides what a click does in the view. Anything that is not a pointing gesture (settings,
 * toggles) lives in the dock, not here.
 *
 * The first tool is always `nav`: it is the idle state of each mode.
 */
export type ToolId =
  | 'nav'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'polygon'
  | 'text'
  | 'shape-move'
  | 'erase'
  | 'focus'
  | 'pin'
  | 'paint'
  | 'paint-erase'
  | 'cam-move'
  | 'cam-aim'
  | 'sel-rect'
  | 'sel-lasso'
  | 'sel-brush'
  | 'volume'
  | 'translate'
  | 'rotate'
  | 'scale';

export interface ReviewTool {
  id: ToolId;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Keyboard shortcut — repeated in the tooltip and to the right of the label, rail expanded. */
  key: string;
  hintKey: MessageKey;
  /** Restricts the tool to one media type (selection tools are specific to the splat). */
  kind?: MediaKind;
}

/** View action at the bottom of the rail: does not change the armed tool, acts immediately. */
export interface ViewAction {
  id: 'fit' | 'reset';
  icon: LucideIcon;
  labelKey: MessageKey;
  key: string;
}

export const DEFAULT_TOOL: ToolId = 'nav';

const NAV_HINT_MEDIA: MessageKey = 'tool.nav.hintMedia';
const NAV_HINT_SPATIAL: MessageKey = 'tool.nav.hintSpatial';

const nav = (hintKey: MessageKey): ReviewTool => ({
  id: 'nav',
  labelKey: 'tool.nav',
  icon: Hand,
  key: 'V',
  hintKey,
});

/** Drawing tools of the "Annotate" mode — video and image. */
export const DRAW_TOOLS: ReviewTool[] = [
  { id: 'draw', labelKey: 'tool.draw', icon: Pencil, key: 'D', hintKey: 'tool.draw.hint' },
  { id: 'rect', labelKey: 'tool.rect', icon: Square, key: 'R', hintKey: 'tool.rect.hint' },
  { id: 'ellipse', labelKey: 'tool.ellipse', icon: Circle, key: 'E', hintKey: 'tool.ellipse.hint' },
  { id: 'arrow', labelKey: 'tool.arrow', icon: MoveUpRight, key: 'A', hintKey: 'tool.arrow.hint' },
  {
    // DECISION — the polygon was on `G`, the key of the global navigation LEADER
    // (`g` then a letter: `g p` → projects, `g k` → kanban, `g b` → board). The two handlers
    // are bound to different targets (`document` for the global one, `window` for the rail): one
    // keystroke armed the polygon *and* started the sequence, and the next letter left the review,
    // losing the annotation in progress.
    //
    // The leader `g` is not reconfigurable (`isValidKey` rejects it): so the tool gives way.
    // `P` is free on flat media — the surface brush carries it, but only in spatial, where the
    // polygon does not exist.
    id: 'polygon',
    labelKey: 'tool.polygon',
    icon: Hexagon,
    key: 'P',
    hintKey: 'tool.polygon.hint',
  },
  { id: 'text', labelKey: 'tool.text', icon: Type, key: 'T', hintKey: 'tool.text.hint' },
  {
    // DECISION — the shape move was on `M`, the video transport's key ("pause + comment at the
    // current frame"). The transport kept it by stopping the event's bubbling: on a video, the rail
    // button therefore announced `M` and the letter armed nothing — it opened the composer. `S` is
    // free on flat media.
    id: 'shape-move',
    labelKey: 'tool.shapeMove',
    icon: Move,
    key: 'S',
    hintKey: 'tool.shapeMove.hint',
  },
  { id: 'erase', labelKey: 'tool.erase', icon: Eraser, key: 'X', hintKey: 'tool.erase.hint' },
];

/**
 * The "Zoom" tool (`Z`) was REMOVED (Phase 50): it never armed anything. Zoom on the two flat
 * viewers is a permanent gesture — wheel to zoom under the cursor, drag to pan, `+`/`-` on the
 * keyboard — and depends on no tool; the video player even hid it from the rail while leaving it
 * armable from the keyboard. Fit and 1:1 remain offered by the two view actions (`F` and `H`),
 * which do act.
 *
 * The "Wipe bar" (`W`) was REMOVED on the same basis (Phase 50, batch 12): entering comparison
 * **already arms the wipe** (`useCompareArm`), and the bar is then on screen, with its move and
 * rotation handles. The tool therefore repeated the mode from the rail without arming anything
 * more — no handler read this identifier. The choice of comparison mode (wipe, difference,
 * side by side) stays in the options bar, which alone expresses it.
 */
function mediaTools(mode: ModeId): ReviewTool[] {
  const start = nav(NAV_HINT_MEDIA);
  if (mode === 'annotate') return [start, ...DRAW_TOOLS];
  return [start];
}

const FOCUS: ReviewTool = {
  id: 'focus',
  labelKey: 'tool.focus',
  icon: Crosshair,
  key: 'C',
  kind: 'SPLAT',
  hintKey: 'tool.focus.hint',
};

const SPATIAL_TOOLS: Record<string, ReviewTool[]> = {
  explore: [
    nav(NAV_HINT_SPATIAL),
    FOCUS,
    {
      id: 'pin',
      labelKey: 'tool.poi',
      icon: MapPin,
      key: 'I',
      hintKey: 'tool.poi.hint',
    },
  ],
  annotate: [
    nav(NAV_HINT_SPATIAL),
    {
      // The surface brush itself — **both spatial types** (Phase 50, batch 13). It carried
      // `kind: 'SPLAT'` since batch 8, although the request said "in the 3D/splat annotation
      // tools": the restriction did not close a hole, it recorded a gap. On a model, the "Annotate"
      // mode therefore only offered navigation and the pin. The gesture itself needs nothing
      // specific to the cloud — a ray toward a surface, a stroke in object space, a screen
      // resolution: `paint/` now only knows the shared scene handle (`viewer/sceneHandle`), which
      // both viewers fill.
      //
      // Icon decision — at 17 px, `Paintbrush` has the same silhouette as `Pencil`: a thin
      // diagonal tool. That is exactly the confusion to resolve ("clearly differentiate the 2D/3D
      // brush by icon"). `Brush` has a wide head and a paint trace: it reads as "placed ON a
      // surface", whereas the pencil remains a screen stroke.
      // The mask selection brush keeps `SprayCan` (see `clean`).
      //
      // `P` is free in this list: the mask brush of the "Clean up" mode answers to `M`, and
      // `toolSearchOrder` looks it up first. The two brushes therefore do not compete.
      id: 'paint',
      labelKey: 'tool.surfaceBrush',
      icon: Brush,
      key: 'P',
      hintKey: 'tool.surfaceBrush.hint',
    },
    {
      // 3D stroke eraser: a click removes the nearest stroke — the one being prepared, or one of a
      // comment already sent that you authored. `X` is the flat media eraser's letter, and it is
      // not part of the flight alphabet (ZQSD/WASD + A/E). It follows the brush on both spatial
      // types: a brush without an eraser leaves only "clear all" as the way back, which was the
      // defect before batch 8.
      id: 'paint-erase',
      labelKey: 'tool.strokeErase',
      icon: Eraser,
      key: 'X',
      hintKey: 'tool.strokeErase.hint',
    },
    // The "Region" tool (`B`) was REMOVED (Phase 50): both spatial viewers hid it from the
    // rail — so it had no implementation anywhere — and the letter armed it on the keyboard anyway.
    {
      // SAME tool as in "Explore": same label, same instruction, same gesture. It used to carry its
      // own key pair here ("Pin" / "anchor the comment to a point"), which described a different
      // tool from the button next to it — a single point of interest, anchored to the comment,
      // instead of a numbered list placed on click.
      id: 'pin',
      labelKey: 'tool.poi',
      icon: MapPin,
      key: 'I',
      hintKey: 'tool.poi.hint',
    },
  ],
  stage: [
    nav(NAV_HINT_SPATIAL),
    {
      id: 'cam-move',
      labelKey: 'tool.camMove',
      icon: Move3d,
      key: 'T',
      hintKey: 'tool.camMove.hint',
    },
    {
      id: 'cam-aim',
      labelKey: 'tool.camAim',
      icon: Rotate3d,
      key: 'R',
      hintKey: 'tool.camAim.hint',
    },
    { ...FOCUS, hintKey: 'tool.focus.hintStage' },
  ],
  clean: [
    nav(NAV_HINT_SPATIAL),
    {
      id: 'sel-rect',
      labelKey: 'tool.selRect',
      icon: SquareDashed,
      key: 'B',
      kind: 'SPLAT',
      hintKey: 'tool.selRect.hint',
    },
    {
      id: 'sel-lasso',
      labelKey: 'tool.selLasso',
      icon: Lasso,
      key: 'L',
      kind: 'SPLAT',
      hintKey: 'tool.selLasso.hint',
    },
    {
      // Selection brush: it marks the splats to hide, hence its name and its letter (`M`, the mask
      // being what "Clean up" writes). It gave up `P` and the brush icon to the surface brush of the
      // "Annotate" mode — see the decision noted there. `M` clashes with nothing in spatial and stays
      // out of the flight alphabet.
      id: 'sel-brush',
      labelKey: 'tool.maskBrush',
      icon: SprayCan,
      key: 'M',
      kind: 'SPLAT',
      hintKey: 'tool.maskBrush.hint',
    },
    {
      id: 'volume',
      labelKey: 'tool.volume',
      icon: BoxSelect,
      key: 'O',
      kind: 'SPLAT',
      hintKey: 'tool.volume.hint',
    },
    { id: 'translate', labelKey: 'tool.translate', icon: Move3d, key: 'T', hintKey: 'tool.translate.hint' },
    { id: 'rotate', labelKey: 'tool.rotate', icon: Rotate3d, key: 'R', hintKey: 'tool.rotate.hint' },
    { id: 'scale', labelKey: 'tool.scale', icon: Scale3d, key: 'S', hintKey: 'tool.scale.hint' },
  ],
};

/** Tools of the active mode, filtered by media type. */
export function toolsFor(mode: ModeId, kind: MediaKind): ReviewTool[] {
  const tools = isSpatialKind(kind) ? (SPATIAL_TOOLS[mode] ?? []) : mediaTools(mode);
  return tools.filter((t) => !t.kind || t.kind === kind);
}

/**
 * Rail group: a mode's tools, under a title, arming that mode on click.
 *
 * The rail used to have a single list — the current mode's — so a mode absent from the header
 * toggle became unreachable with the mouse. That is what happened to cloud editing in batch 12:
 * the "Clean up" segment was removed, and its tools ended up behind a viewer popover, whereas the
 * request was to remove the segment, not to hide the tools. A second group brings them back **to
 * their place**, without rendering the segment.
 *
 * The title and tools remain data from `tools.ts`: the rail and the keyboard both read `toolsFor`,
 * so a group cannot offer anything that is not already a declared tool.
 */
export interface RailSection {
  /** Mode armed by a click in this group. */
  mode: ModeId;
  titleKey: MessageKey;
  tools: ReviewTool[];
}

/**
 * Lookup order of a tool shortcut: the current mode first, then the others — pressing the key of a
 * tool from another mode **switches** to that mode. In spatial, `clean` comes first among the others:
 * T/R/S are the standard DCC gizmos and must answer from any mode (the camera tools of "Staging",
 * which share T/R, keep control when you are already there).
 */
export function toolSearchOrder(kind: MediaKind, current: ModeId): ModeId[] {
  const all = modesFor(kind).map((m) => m.value);
  const others = isSpatialKind(kind) ? ['clean' as ModeId, ...all] : all;
  return [current, ...others.filter((mode, index) => mode !== current && others.indexOf(mode) === index)];
}

const SPATIAL_ACTIONS: ViewAction[] = [
  { id: 'fit', icon: Frame, labelKey: 'action.fitSpatial', key: 'F' },
  { id: 'reset', icon: Home, labelKey: 'action.resetSpatial', key: 'H' },
];

const MEDIA_ACTIONS: ViewAction[] = [
  { id: 'fit', icon: Maximize2, labelKey: 'action.fitMedia', key: 'F' },
  { id: 'reset', icon: Scan, labelKey: 'action.resetMedia', key: 'H' },
];

/** View actions at the bottom of the rail, after the separator. */
export function viewActionsFor(kind: MediaKind): ViewAction[] {
  return isSpatialKind(kind) ? SPATIAL_ACTIONS : MEDIA_ACTIONS;
}
