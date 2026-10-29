// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import type { MediaKind, Role } from '../../../types/api';
import { Badge } from '../../../components/ui/badge';
import { ErrorBoundary } from '../../../components/ui/error-boundary';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import ToolRail from './ToolRail';
import InspectorDock from './InspectorDock';
import { useReviewHeaderSlots } from '../header/reviewHeaderSlots';
import { DEFAULT_MODE, canSwitchMode, switcherModesFor, type ModeId, type ReviewMode } from './modes';
import { panelsFor, type PanelId } from './panels';
import {
  toolsFor,
  viewActionsFor,
  type RailSection,
  type ReviewTool,
  type ToolId,
  type ViewAction,
} from './tools';
import type { ChromeState } from './chromeState';
import './chrome.css';
import { useT } from '../../../i18n';

/**
 * Review chrome container: the five fixed slots, identical for the four media types. Mode toggle
 * at the top, tool rail on the left, options bar under the header, inspector dock on the right,
 * time or zoom at the bottom.
 *
 * The media keeps only the overlays anchored to the view (strokes, pins, wipe bar, guides, PiP,
 * axis triad, counter): no setting covers the image being judged any more.
 */
export default function ReviewChrome({
  kind,
  state,
  onState,
  role,
  modes: modesProp,
  tools: toolsProp,
  railExtra,
  headerLeft,
  headerRight,
  options,
  panel,
  transport,
  drawer,
  comments,
  onViewAction,
  dirty,
  children,
}: {
  kind: MediaKind;
  state: ChromeState;
  onState: (patch: Partial<ChromeState>) => void;
  role: Role;
  /**
   * Modes offered by the toggle. By default those of the media type; the edit mount has only one
   * (watch), since A/B comparison makes no sense on an assembled film. Below two, the toggle
   * disappears rather than showing a single segment that switches to nothing.
   */
  modes?: ReviewMode[];
  /**
   * Rail tools. By default those of the mode and the media type; the mount supplies its own,
   * including a navigation tool that promises neither pan nor zoom — it has none.
   */
  tools?: ReviewTool[];
  /**
   * Extra tool group, under the current mode's: the rail of a mode **valid but absent from the
   * toggle**. This is how cloud editing returns to the rail (Phase 50, batch 13) — the "Clean up"
   * segment left the header, but its tools should not leave the left side of the screen either.
   *
   * While this mode is the current one, the first group shows the default mode's: the rail keeps
   * the same shape from one end to the other, and clicking one of its tools is the way out of the
   * mode — otherwise one would be locked in, the toggle having no segment left to render.
   */
  railExtra?: RailSection;
  /**
   * Media, version, navigation — on the left of the header. The review provides them through
   * context (`ReviewHeaderSlots`); this prop serves the edit mount's player, which lacks that context.
   */
  headerLeft?: ReactNode;
  /**
   * Viewer A/B — on the right of the header, in front of the page actions. This is where 3D and
   * splat place their version selector, fed by their own hook.
   */
  headerRight?: ReactNode;
  /** `<OptionsBar>` of the active tool. */
  options: ReactNode;
  /** Content of the open panel. */
  panel: ReactNode;
  transport?: ReactNode;
  /** Drawer anchored under the transport (curves or filmstrip). */
  drawer?: ReactNode;
  /** Last column. The review provides it through context; this prop forces it. */
  comments?: ReactNode;
  /**
   * Fit / original view. Absent when the viewer does not implement them: the rail then does not
   * show these two buttons rather than offering inert ones.
   */
  onViewAction?: (action: ViewAction['id']) => void;
  /** Pending edits — comes from the editing hooks, not from the chrome state. */
  dirty?: boolean;
  /** The viewport, full space. */
  children: ReactNode;
}) {
  const t = useT();
  // Single header: the review page places identity, actions and comments here rather than
  // in a bar of its own. Outside review (edit mount player), the context is absent and only
  // the props count.
  const slots = useReviewHeaderSlots();
  const left = headerLeft ?? slots?.identity;
  // Both coexist without displacing each other: the viewer A/B first, then the page actions
  // after — this is the only place where the two halves of the old header meet.
  const hasRight = Boolean(headerRight) || Boolean(slots?.actions);
  const commentsColumn = comments ?? slots?.comments;
  // The toggle does not list "Annotate": annotation is armed from the comment space.
  // The mode stays valid — during annotation no segment is active and the composer's button
  // acts as the indicator; the footer keeps the right reminder.
  const modes = modesProp ?? switcherModesFor(kind);
  // No more "hidden" tool list (Phase 50): it only filtered the rail, and the key letter still
  // armed the removed tool. A tool a viewer does not implement no longer exists at all —
  // either it carries its media type (`kind`), or it was removed from `tools.ts`.
  //
  // Mode of the FIRST group: the chrome's, except when it is the extra group's mode
  // — then the default mode's is shown, which is the way out.
  const mainMode = railExtra?.mode === state.mode ? DEFAULT_MODE : state.mode;
  const tools = toolsProp ?? toolsFor(mainMode, kind);
  const sections: RailSection[] = [
    { mode: mainMode, titleKey: 'rail.tools', tools },
    ...(railExtra && railExtra.tools.length > 0 ? [railExtra] : []),
  ];
  const panels = panelsFor(kind);
  // The client does not see the toggle: it stays in explore mode, read-only.
  const switchable = canSwitchMode(role, modes.length);

  return (
    <div
      // The 1440 px minimum width made the review unusable on a laptop:
      // below this threshold, the whole page scrolled horizontally (D1). The rail and the
      // dock now fold by themselves, and the header bar wraps onto a new line.
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Single header: identity on the left, mode toggle in the center, viewer A/B then
          page actions on the right. It wraps onto a new line rather than overflowing — the merged
          bar is much busier than the lone toggle it used to carry. */}
      <header className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-2">
        {left && <div className="flex min-w-0 flex-shrink items-center gap-2">{left}</div>}
        {switchable && (
          <div className="mx-auto flex items-center gap-2">
            <SegmentedControl
              size="lg"
              label={t('review.mode')}
              // No mode is closed by publication any more: the last one — the video cut — was
              // removed in Phase 50. A greyed-out mode therefore no longer exists.
              items={modes.map((m, index) => ({
                value: m.value,
                label: t(m.labelKey),
                icon: m.icon,
                hint: `${t(m.labelKey)} (${index + 1}) — ${t(m.hintKey)}`,
              }))}
              value={state.mode}
              onChange={(mode: ModeId) => onState({ mode })}
            />
          </div>
        )}
        {hasRight && (
          <div className={`flex flex-shrink-0 items-center gap-2 text-sm${switchable ? '' : ' ml-auto'}`}>
            {headerRight}
            {slots?.actions}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <ToolRail
          sections={sections}
          actions={onViewAction ? viewActionsFor(kind) : []}
          mode={state.mode}
          tool={state.tool}
          onTool={(tool: ToolId, mode: ModeId) => onState({ tool, mode })}
          onAction={(action) => onViewAction?.(action)}
          labels={state.labels}
          onLabels={() => onState({ labels: !state.labels })}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {options}
          {/* The viewport mounts Three.js, Spark or hls.js. Since comments are a column of the
              chrome, a WebGL crash would take them down too: the boundary moves down right at
              the viewer, so the header, the dock and the comment thread survive the view
              falling over. */}
          <ErrorBoundary scope="viewer">{children}</ErrorBoundary>
          {transport}
          {drawer}
        </div>

        <InspectorDock
          panels={panels}
          panel={state.panel}
          onPanel={(next: PanelId | null) => onState({ panel: next })}
        >
          {panel}
        </InspectorDock>

        {commentsColumn}
      </div>

      {/* The footer now only says what has a CONSEQUENCE: is there anything left to save.
          It used to narrate the active mode and the state of the rail and dock — sentences the
          reader already has in front of them, which took up a strip permanently to teach them
          nothing. The mode is still explained in its button's tooltip, where one looks for it
          when wondering. */}
      {dirty !== undefined && (
        <footer className="flex flex-shrink-0 items-center justify-end border-t border-border bg-card/60 px-2.5 py-[0.3125rem]">
          <Badge variant={dirty ? 'warning' : 'success'}>
            {dirty ? t('common.notSaved') : t('common.saved')}
          </Badge>
        </footer>
      )}
    </div>
  );
}
