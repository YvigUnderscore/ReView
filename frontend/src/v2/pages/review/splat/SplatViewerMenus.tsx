// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/v2/components/ui/popover';
import DisplayPanel from '../panels/DisplayPanel';
import type { SplatCompareState } from './compare/useSplatCompare';
import type { SplatEditorState } from './editor/useSplatEditor';
import type { PresentationState } from './presentation/usePresentation';
import { useT } from '@/v2/i18n';

/**
 * Menu of the splat viewer, **inside the viewer**: top-left corner, as a popover, exactly like the render
 * settings of the 3D model (`three/Model3DRenderMenu`, batch 6).
 *
 * Only one remains, **Render**: the **same** `DisplayPanel` that the "Display" tab of the dock served, whole
 * (cloud render mode, orientation, raw scale of the comparison, inspection tint). The tab has disappeared; a
 * setting added tomorrow therefore reaches both spatial viewers, or neither.
 *
 * The "Edit" popover of batch 12 was REMOVED in batch 13. It carried the tools of the "Clean up" mode and the
 * switch that entered it, whereas filing tools behind a click was not the request: it was removing the SEGMENT
 * from the header. The tools therefore came back to the rail, in a second permanent group
 * (`splatChrome.splatEditRail`), where they are directly clickable; clicking one of them arms the mode, and the
 * first group of the rail (that of the default mode) is the way out. The popover kept no setting of its own:
 * everything that was one (cloud rendering, orientation) is here, and everything that was a tool is on the rail.
 *
 * The component is mounted by the pane's **`settings` slot**, outside `ReviewFrame`: the letterbox guide and the
 * normalised annotation coordinates do not move, and the popover descends along the left edge rather than
 * covering the centre of the frame, which is what one is looking at.
 */

/**
 * Trigger styling: identical to that set in batch 6 by `Model3DRenderMenu`. It is the same command, in the
 * same corner, in both spatial viewers. The day a third viewer wants one, this string moves into `chrome.css`
 * and both menus read it there.
 */
const TRIGGER =
  'flex items-center gap-1.5 rounded-md border border-border bg-card/85 px-2 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-card hover:text-foreground data-[state=open]:bg-card data-[state=open]:text-foreground';

export default function SplatViewerMenus({
  editor,
  showEdit,
  pres,
  compare,
}: {
  editor: SplatEditorState;
  /** Editor mounted (editable media + manager): render mode and orientation depend on it. */
  showEdit: boolean;
  /** Inspection tint: session setting, offered to everyone. */
  pres: Pick<PresentationState, 'debugMode' | 'setDebugMode'>;
  /** A/B comparison: carries the raw scale of the compared clouds. */
  compare?: SplatCompareState;
}) {
  const t = useT();

  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger
          title={t('viewer.render.title')}
          aria-label={t('viewer.render.title')}
          className={TRIGGER}
        >
          <SlidersHorizontal size={13} />
          {t('viewer.render.title')}
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-60 flex-col gap-4 p-3">
          <DisplayPanel
            // Render mode and orientation are edits: reserved to the mounted editor.
            splat={
              showEdit
                ? {
                    mode: editor.renderMode,
                    onMode: editor.setRenderMode,
                    baseFlip: editor.baseFlip,
                    onBaseFlip: () => editor.toggleBaseFlip(),
                  }
                : undefined
            }
            realSize={
              compare?.enabled
                ? { value: !compare.normalized, onChange: compare.toggleNormalized }
                : undefined
            }
            debugMode={pres.debugMode}
            onDebugMode={pres.setDebugMode}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
