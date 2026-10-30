// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, EyeOff, GripVertical, Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import EntityContextMenu from '../ui/entity-menu';
import { separator, type MenuEntry } from '../../lib/menuSpec';
import {
  heightClass,
  spanClass,
  type ResolvedWidgetSettings,
  type WidgetDensity,
  type WidgetHeight,
  type WidgetSettings,
  type WidgetSpan,
  type WidgetVariant,
} from '../../lib/widgetLayout';
import { useT, type MessageKey } from '../../i18n';

/**
 * Common frame of a composable block — header, handle, settings, context menu.
 *
 * It was born on the Home page (C2), where each widget rendered its own frame: there was then
 * no place to hang a handle or a setting. The project overview needs the same frame; so it no
 * longer reads the home registry but receives what it displays — title, widths and proposed
 * variants.
 *
 * The labels stay under the `home.widget.*` prefix: they are word for word the same messages
 * ("Hide", "Width", "Move before"…), and a key is not renamed for the sake of tidiness — it
 * would be renamed in fourteen catalogues without a single word changing on screen.
 */

const HEIGHT_LABEL: Record<WidgetHeight, MessageKey> = {
  short: 'home.widget.height.short',
  normal: 'home.widget.height.normal',
  tall: 'home.widget.height.tall',
};

const VARIANT_LABEL: Record<WidgetVariant, MessageKey> = {
  list: 'home.widget.variant.list',
  grid: 'home.widget.variant.grid',
  kpi: 'home.widget.variant.kpi',
};

const DENSITY_LABEL: Record<WidgetDensity, MessageKey> = {
  comfortable: 'display.density.comfortable',
  compact: 'display.density.compact',
};

/**
 * What the rearrange mode provides to the frame — and nothing more.
 *
 * The frame used to call `useSortable` itself, which put @dnd-kit (16.8 kB gzip) in everyone's
 * first load, for a gesture the vast majority of sessions never make (F5). Drag and drop now
 * lives in `WidgetSortable`, loaded when entering edit mode; outside edit mode, `drag` is
 * `undefined` and the rendering is identical to what `useSortable({ disabled: true })` used to
 * produce: no transform, no transition.
 */
export interface WidgetDragHandle {
  ref: (node: HTMLElement | null) => void;
  style: CSSProperties;
  dragging: boolean;
  /** ARIA attributes and listeners of the handle, passed as-is by dnd-kit. */
  handleProps: ButtonHTMLAttributes<HTMLButtonElement>;
}

/**
 * What a page provides whose grid is made of **rows** — the project overview (batch 12), then
 * the home page (batch 13), which asked for "the same settings".
 *
 * The frame knows neither the height scale nor the gesture that walks it: it receives the grid
 * class to apply, the setting to show in the panel in place of the historical scale, and the
 * handle to place in the corner. Absent, the frame falls back to width alone and the
 * `short`/`normal`/`tall` scale: that is the rendering from before the rows, which no page
 * requests today.
 */
export interface WidgetRowSizing {
  /** Class carrying the vertical footprint (`row-span-N`), written out in full. */
  className: string;
  /** Height setting of the panel — replaces the historical scale. */
  control: ReactNode;
  /** Corner handle: rendered by the page, positioned by the frame. */
  handle: ReactNode;
}

export interface WidgetShellProps {
  /** Block identifier: used to name the menu entries and the `data-widget`. */
  id: string;
  title: string;
  /** Widths offered to the setting; a single one = no choice. */
  spans: WidgetSpan[];
  variants: [WidgetVariant, ...WidgetVariant[]];
  settings: ResolvedWidgetSettings;
  editing: boolean;
  onSettings: (patch: WidgetSettings) => void;
  onHide: () => void;
  onEdit: () => void;
  /** Moving one place, by keyboard as by mouse — dragging is not the only way. */
  onMove: (direction: -1 | 1) => void;
  canMoveBefore: boolean;
  canMoveAfter: boolean;
  /** Provided only by the rearrange mode; absent, the frame knows nothing of dnd-kit. */
  drag?: WidgetDragHandle;
  /** Provided only by the pages whose grid has rows. */
  rowSizing?: WidgetRowSizing;
  children: ReactNode;
}

export default function WidgetShell({
  id,
  title,
  spans,
  variants,
  settings,
  editing,
  onSettings,
  onHide,
  onEdit,
  onMove,
  canMoveBefore,
  canMoveAfter,
  drag,
  rowSizing,
  children,
}: WidgetShellProps) {
  const t = useT();

  const entries: MenuEntry[] = [
    { id: `edit-${id}`, label: t('home.widget.edit'), icon: <Settings2 size={14} />, onSelect: onEdit },
    separator(`move-${id}`),
    {
      id: `before-${id}`,
      label: t('home.widget.moveBefore'),
      icon: <ArrowLeft size={14} />,
      disabled: !canMoveBefore,
      onSelect: () => onMove(-1),
    },
    {
      id: `after-${id}`,
      label: t('home.widget.moveAfter'),
      icon: <ArrowRight size={14} />,
      disabled: !canMoveAfter,
      onSelect: () => onMove(1),
    },
    separator(`hide-${id}`),
    {
      id: `hide-${id}`,
      label: t('home.widget.hide', { name: title }),
      icon: <EyeOff size={14} />,
      onSelect: onHide,
    },
  ];

  const choice = <T extends string | number>(
    current: T,
    values: readonly T[],
    label: (v: T) => string,
    apply: (v: T) => void,
  ) => (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <button
          key={String(value)}
          onClick={() => apply(value)}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
            value === current
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {value === current && <Check size={11} />}
          {label(value)}
        </button>
      ))}
    </div>
  );

  return (
    <section
      ref={drag?.ref}
      style={drag?.style}
      // `grid grid-rows-1` is not decorative: between this frame and the card, the context menu
      // adds its own container, without height. The card's `h-full` would resolve there to
      // "content height", and the set footprint would only reserve an empty space beneath it.
      // A single row in `1fr` brings the height down to the card; the absolute handle stays out of flow.
      className={`col-span-12 ${spanClass(settings.span)} ${
        rowSizing ? `relative grid grid-rows-1 ${rowSizing.className}` : ''
      } ${drag?.dragging ? 'z-10 opacity-60' : ''}`}
      data-widget={id}
    >
      <EntityContextMenu entries={entries} nested>
        <div
          className={`flex h-full flex-col ${
            settings.bare ? '' : 'rounded-lg border border-border bg-card p-4'
          } ${editing ? 'ring-1 ring-primary/40' : ''}`}
        >
          {(!settings.bare || editing) && (
            <header className="mb-3 flex items-center gap-2">
              {editing && (
                <button
                  {...drag?.handleProps}
                  title={t('home.widget.drag')}
                  aria-label={t('home.widget.drag')}
                  className="cursor-grab rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <GripVertical size={14} />
                </button>
              )}
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
              {editing && (
                <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        title={t('home.widget.edit')}
                        aria-label={t('home.widget.edit')}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <Settings2 size={14} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-3 p-3">
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{t('home.widget.width')}</p>
                        {choice<WidgetSpan>(
                          settings.span,
                          spans,
                          (v) => `${String(v)}/12`,
                          (v) => onSettings({ span: v }),
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{t('home.widget.height')}</p>
                        {rowSizing
                          ? rowSizing.control
                          : choice<WidgetHeight>(
                              settings.height,
                              ['short', 'normal', 'tall'],
                              (v) => t(HEIGHT_LABEL[v]),
                              (v) => onSettings({ height: v }),
                            )}
                      </div>
                      {variants.length > 1 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">
                            {t('home.widget.variant')}
                          </p>
                          {choice<WidgetVariant>(
                            settings.variant,
                            variants,
                            (v) => t(VARIANT_LABEL[v]),
                            (v) => onSettings({ variant: v }),
                          )}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{t('display.density')}</p>
                        {choice<WidgetDensity>(
                          settings.density,
                          ['comfortable', 'compact'],
                          (v) => t(DENSITY_LABEL[v]),
                          (v) => onSettings({ density: v }),
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={settings.bare}
                          onChange={(e) => onSettings({ bare: e.target.checked })}
                        />
                        {t('home.widget.bare')}
                      </label>
                    </PopoverContent>
                  </Popover>
                  <button
                    onClick={onHide}
                    title={t('home.widget.hide', { name: title })}
                    aria-label={t('home.widget.hide', { name: title })}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <EyeOff size={14} />
                  </button>
                </>
              )}
            </header>
          )}
          {/* Row grid: the card has an imposed height, so it is the content that scrolls —
              never the card growing, otherwise the set footprint would no longer mean anything. */}
          <div className={`min-h-0 flex-1 ${rowSizing ? 'overflow-y-auto' : heightClass(settings.height)}`}>
            {children}
          </div>
        </div>
      </EntityContextMenu>
      {rowSizing?.handle}
    </section>
  );
}
