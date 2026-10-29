// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { switcherModesFor, type ModeId, type ReviewMode } from '../chrome/modes';
import { DEFAULT_TOOL, toolsFor, type ReviewTool } from '../chrome/tools';
import type { MessageKey } from '../../../i18n';

/**
 * Mode switcher and rail of the **3D model** viewer: the only deviations from the common spatial
 * chrome, gathered here rather than scattered in `modes.ts`, which the splat also uses.
 *
 * Two decisions of Phase 50, batch 6, taken from what the screen actually offered:
 *
 *  1. **"Staging" is no longer a segment.** The mode only existed to turn on the layout (PiP view +
 *     object camera + camera tools + "Publish" button), and the Camera panel already carried the
 *     toggle doing the same thing. Two controls for one state, which contradicted each other as soon
 *     as the mode changed. The mode stays **valid**: the Camera panel toggle arms it, exactly as
 *     "Annotate" is armed from the comment space without appearing in the switcher. Nothing is removed.
 *
 *  2. **"Clean" only shows when it is useful.** On a 3D model, its only tools are the TRS gizmos —
 *     the point-cloud selection tools are specific to the splat. These gizmos write to one of TWO
 *     places, and it is enough for one of the two to be reachable:
 *
 *       - without a selection, the **version transform**: it requires
 *         `permissions.editTransform` (version author or manager, before publication), computed by
 *         the server. Without this right, the mode only offered a "Save" refused with a 403;
 *       - with prims selected in a USD scene, the **scene override** (46.N): a delta replayed for
 *         everyone when a manager saves it, and reachable by a comment from any reviewer. It does not
 *         go through the version transform and therefore does not have its rights.
 *
 *     The condition is thus "one OR the other". Judging it on the right to write the version
 *     transform alone would have removed the per-prim gizmo for all non-authors — removing a feature
 *     by removing its tab, exactly what we are trying to avoid.
 */

/** What makes the "Clean" mode reachable on a 3D model. */
export interface Model3DCleanReach {
  /** `permissions.editTransform` of the media detail: the version transform. */
  canEditTransform: boolean;
  /** The USD scene has a scenegraph: the gizmos can target a prim (scene override). */
  hasScenegraph: boolean;
}

/**
 * What "Clean" really does on a model: transform. Existing key, same message —
 * it is the label the edit history already gives this gesture.
 */
const CLEAN_HINT: MessageKey = 'model3d.transformModel';

/** Tools of the "Clean" mode that really do something (excluding the idle state). */
export function model3dCleanTools(): ReviewTool[] {
  return toolsFor('clean', 'MODEL_3D').filter((tool) => tool.id !== DEFAULT_TOOL);
}

/**
 * Is the "Clean" mode usable? Both are needed: at least one tool on the rail, **and** a place to
 * keep what it produces. Either one alone is a dead end — an empty rail, or work that cannot be kept.
 */
export function canCleanModel3d({ canEditTransform, hasScenegraph }: Model3DCleanReach): boolean {
  const somewhereToSave = canEditTransform || hasScenegraph;
  return somewhereToSave && model3dCleanTools().length > 0;
}

/**
 * Switcher segments for a 3D model, in display order (and keys 1, 2…).
 *
 * The "Clean" tooltip is rewritten along the way: the spatial chrome one promises
 * "selection, deletion, cut volumes, transform", four gestures of which only one exists on a model —
 * the other three are point-cloud tools, specific to the splat. A model only has the gizmos, and
 * the tooltip now says so.
 */
export function model3dSwitcherModes(canClean: boolean): ReviewMode[] {
  return switcherModesFor('MODEL_3D')
    .filter((mode) => mode.value !== 'stage' && (canClean || mode.value !== 'clean'))
    .map((mode) => (mode.value === 'clean' ? { ...mode, hintKey: CLEAN_HINT } : mode));
}

/**
 * Tools actually on the rail for a given mode. An unavailable "Clean" yields an empty list:
 * otherwise `T`/`R`/`S` would keep switching to it from the keyboard — the dead button would come
 * back through the service door, rail or not.
 */
export function model3dToolsFor(mode: ModeId, canClean: boolean): ReviewTool[] {
  if (mode === 'clean' && !canClean) return [];
  return toolsFor(mode, 'MODEL_3D');
}
