// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../../i18n';
import { switcherModesFor, type ModeId, type ReviewMode } from '../chrome/modes';
import { DEFAULT_TOOL, toolsFor, type RailSection, type ReviewTool } from '../chrome/tools';

/**
 * Mode switch and rail of the **splat** viewer: the only deviations from the common spatial chrome,
 * gathered here rather than in `chrome/modes.ts`, which the 3D model also uses. Twin of
 * `three/model3dChrome.ts`, which does the same job for the other spatial viewer.
 *
 * Two segments leave the header switch in Phase 50, lot 12:
 *
 *  1. **"Staging"**: exactly the reasoning of lot 6 on the 3D side. The mode only exists to turn on
 *     the camera workshop (PiP, camera-object, camera tools, "Publish" button), and the Camera panel
 *     already carries the toggle that does this (`SplatPanels`, `staging` prop). Two commands for one
 *     state, which contradicted each other as soon as one changed mode.
 *
 *  2. **"Clean up"**: the segment repeated from the header a job that is done by looking at the cloud.
 *
 * Lot 12 had moved its tools into a viewer popover, and that went too far: the request was to remove
 * the segment, not to tuck the tools behind a click. Lot 13 therefore brings them back to the RAIL,
 * in a second permanent group (`splatEditRail`): selecting, deleting, moving and scaling are again
 * one click away, with no mode to arm in the header. The "Edit" popover disappeared with its
 * duplicate; the render one remains.
 *
 * In both cases the mode remains **valid**: nothing is deleted, only the path changes. The Camera
 * panel toggle arms staging; the second rail group arms clean-up; and the letters (`B`, `L`, `M`,
 * `O`, `T`, `R`, `S`) lead there as before: `toolsFor` remains the sole authority of the rail **and**
 * of the keyboard, so no tool removed from a surface becomes armable quietly or orphaned.
 *
 * Only "Explore" remains: a single segment switches to nothing, so `canSwitchMode` removes the
 * splat's switch, which is what the user asked for, without losing a command.
 */
export function splatSwitcherModes(): ReviewMode[] {
  return switcherModesFor('SPLAT').filter((mode) => mode.value !== 'stage' && mode.value !== 'clean');
}

/** Title of the second group of the rail: the same word the popover it replaces carried. */
const EDIT_TITLE: MessageKey = 'viewer.edit.title';

/**
 * Cloud editing tools, as the rail lists them: those of the "Clean up" mode, excluding the rest
 * state. `nav` stays in the first group, where it is the rest state of all modes; it is also
 * through it that one leaves editing.
 */
export function splatEditTools(): ReviewTool[] {
  return toolsFor('clean', 'SPLAT').filter((tool) => tool.id !== DEFAULT_TOOL);
}

/**
 * Second rail group: present only when the editor is mounted (`showEdit`: editable media, rights,
 * viewer ready). Without it, these tools write nowhere: showing them would offer to delete splats
 * to those who cannot.
 */
export function splatEditRail(showEdit: boolean): RailSection | undefined {
  if (!showEdit) return undefined;
  return { mode: 'clean', titleKey: EDIT_TITLE, tools: splatEditTools() };
}

/**
 * Tools actually on the rail and on the keyboard for a given mode. With the editor absent, this
 * returns an empty list for "Clean up": otherwise `B`/`L`/`M`/`O`/`T`/`R`/`S` would keep switching
 * to it from the keyboard while the rail group has disappeared, and the tool without an
 * implementation would come back through the back door. Same rule as `model3dToolsFor` on the
 * model side.
 */
export function splatToolsFor(mode: ModeId, showEdit: boolean): ReviewTool[] {
  if (mode === 'clean' && !showEdit) return [];
  return toolsFor(mode, 'SPLAT');
}
