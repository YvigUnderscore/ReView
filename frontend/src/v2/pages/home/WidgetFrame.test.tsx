// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WidgetFrame, { type WidgetDragHandle } from './WidgetFrame';
import { widgetSettings } from './homeWidgets';
import type { WidgetSize } from '../../components/widgets/widgetSizing';
import { t } from '../../i18n';

/**
 * The frame of a home block: removing @dnd-kit from the first load (F5), then resizing (batch 13).
 *
 * The frame called `useSortable({ disabled: !editing })`, which shipped the drag-and-drop engine to
 * everyone for an optional gesture. It now receives, from the rearrangement mode alone, what the
 * drag used to give it. What must be locked down is the equivalence: outside edit mode, the
 * rendering must be **exactly** that produced by a disabled `useSortable`, with no transform, no
 * transition and no handle.
 */

const BASE = {
  id: 'myTasks' as const,
  settings: widgetSettings('myTasks', undefined),
  onSettings: () => {},
  onHide: () => {},
  onEdit: () => {},
  onMove: () => {},
  canMoveBefore: true,
  canMoveAfter: true,
  onPreview: () => {},
  onResize: () => {},
};

const sectionOf = () => document.querySelector<HTMLElement>('section[data-widget="myTasks"]');
const handleOf = () => screen.queryByTitle(t('overview.widget.resizeHint'));

describe('WidgetFrame', () => {
  it('outside edit mode, carries neither a move style nor a handle', () => {
    render(
      <WidgetFrame {...BASE} editing={false}>
        <p>contenu</p>
      </WidgetFrame>,
    );
    const section = sectionOf();
    expect(section).not.toBeNull();
    // A disabled `useSortable` rendered `transform: undefined, transition: undefined`: in other
    // words, nothing. It is that "nothing" that is verified.
    expect(section?.getAttribute('style')).toBeNull();
    expect(screen.queryByRole('button', { name: /d(é|e)placer|drag/i })).not.toBeInTheDocument();
    // The size handle is a composition command: it lives with the move handle, and disappears
    // with it.
    expect(handleOf()).toBeNull();
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });

  it('in rearrangement mode, applies what the drag gives it', () => {
    const drag: WidgetDragHandle = {
      ref: () => {},
      style: { transform: 'translate3d(12px, 0, 0)', transition: 'transform 200ms ease' },
      dragging: true,
      handleProps: { 'aria-roledescription': 'sortable', role: 'button' },
    };
    render(
      <WidgetFrame {...BASE} editing drag={drag}>
        <p>contenu</p>
      </WidgetFrame>,
    );
    const section = sectionOf();
    expect(section?.style.transform).toBe('translate3d(12px, 0, 0)');
    expect(section?.style.transition).toBe('transform 200ms ease');
    // The block being moved fades out, as before.
    expect(section?.className).toContain('opacity-60');
    expect(document.querySelector('[aria-roledescription="sortable"]')).not.toBeNull();
  });

  it('carries the set footprint: width in columns, height in rows', () => {
    render(
      <WidgetFrame {...BASE} settings={{ ...BASE.settings, span: 8, rows: 5 }} editing={false}>
        <p>contenu</p>
      </WidgetFrame>,
    );
    const section = sectionOf();
    expect(section?.className).toContain('xl:col-span-8');
    expect(section?.className).toContain('row-span-5');
    // Without this single `1fr` row, the height would not reach the card, and the set footprint
    // would only reserve empty space beneath it.
    expect(section?.className).toContain('grid-rows-1');
  });

  it('in composition, the handle sets BOTH width and height from the keyboard', () => {
    const sizes: WidgetSize[] = [];
    render(
      <WidgetFrame
        {...BASE}
        editing
        onResize={(size) => {
          sizes.push(size);
        }}
      >
        <p>contenu</p>
      </WidgetFrame>,
    );
    const handle = handleOf();
    expect(handle).not.toBeNull();
    if (!handle) return;
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    // Each key saves from the displayed size (6 columns, 4 rows by default): width on the right,
    // height at the bottom.
    expect(sizes).toEqual([
      { span: 8, rows: 4 },
      { span: 6, rows: 5 },
    ]);
  });

  it('saves nothing when the arrow key does not change the size', () => {
    const sizes: WidgetSize[] = [];
    render(
      <WidgetFrame
        {...BASE}
        settings={{ ...BASE.settings, span: 12, rows: 6 }}
        editing
        onResize={(size) => {
          sizes.push(size);
        }}
      >
        <p>contenu</p>
      </WidgetFrame>,
    );
    const handle = handleOf();
    if (!handle) return;
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(sizes).toEqual([]);
  });
});
