// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import WidgetShell, { type WidgetDragHandle } from '../../components/widgets/WidgetShell';
import WidgetResizeHandle, { WidgetRowsChoice } from '../../components/widgets/WidgetResizeHandle';
import { rowSpanClass, type WidgetSize } from '../../components/widgets/widgetSizing';
import {
  HOME_WIDGETS,
  type HomeResolvedSettings,
  type HomeWidgetId,
  type HomeWidgetSettings,
} from './homeWidgets';
import { useT } from '../../i18n';

/**
 * Frame of a home block: the common frame (`components/widgets/WidgetShell`), to which this file
 * adds what only the home page knows: the block's title, its widths and its variants, read from
 * its registry.
 *
 * The frame itself is shared with the project overview: it is the same header, the same handle,
 * the same menu and the same settings. What differs from one page to another is the list of
 * blocks, not how they are framed.
 *
 * Since batch 13, the **resizing** is also mounted here: the registry gives the offered widths and
 * the title the handle announces, so the grid only needs to say which size is shown and what to do
 * with the new one. The handle appears only in composition mode, together with the move handle.
 */
export type { WidgetDragHandle };

export interface WidgetFrameProps {
  id: HomeWidgetId;
  /** Displayed size, including during a drag: while dragging, that of the preview. */
  settings: HomeResolvedSettings;
  editing: boolean;
  onSettings: (patch: HomeWidgetSettings) => void;
  onHide: () => void;
  onEdit: () => void;
  /** Move by one place, by keyboard as well as by mouse: dragging is not the only path. */
  onMove: (direction: -1 | 1) => void;
  canMoveBefore: boolean;
  canMoveAfter: boolean;
  /** Size under the cursor during a drag; `null` when it ends. */
  onPreview: (size: WidgetSize | null) => void;
  /** Retained size: the only one of the two that is saved. */
  onResize: (size: WidgetSize) => void;
  /** Supplied by the rearrangement mode alone; when absent, the frame does not know dnd-kit. */
  drag?: WidgetDragHandle;
  children: ReactNode;
}

export default function WidgetFrame({
  id,
  settings,
  onPreview,
  onResize,
  children,
  ...rest
}: WidgetFrameProps) {
  const t = useT();
  const definition = HOME_WIDGETS[id];
  const title = t(definition.labelKey);
  const size: WidgetSize = { span: settings.span, rows: settings.rows };

  return (
    <WidgetShell
      id={id}
      title={title}
      spans={definition.spans}
      variants={definition.variants}
      settings={settings}
      rowSizing={{
        className: rowSpanClass(size.rows),
        control: <WidgetRowsChoice rows={size.rows} onRows={(rows) => onResize({ ...size, rows })} />,
        // The handle is a composition command: it lives with the move handle, and disappears with
        // it.
        handle: rest.editing ? (
          <WidgetResizeHandle
            name={title}
            size={size}
            spans={definition.spans}
            onPreview={onPreview}
            onCommit={onResize}
          />
        ) : null,
      }}
      {...rest}
    >
      {children}
    </WidgetShell>
  );
}
