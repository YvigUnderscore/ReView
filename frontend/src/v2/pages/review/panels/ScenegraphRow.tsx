// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo } from 'react';
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import type { PrimNode } from '../three/usdScenegraph';
import { useT } from '../../../i18n';

/**
 * A row of the virtualised scenegraph, positioned absolutely in the virtualizer's spacer.
 *
 * It only receives values already decided (flags, labels) and stable functions: this is what makes
 * `memo` effective, and therefore what avoids replaying the twenty mounted rows on each scroll event.
 * It mounts **no** context menu: the panel holds only one, which finds the targeted row on right-click
 * (`data-prim-path`).
 */

/**
 * Position and measurement of a row in the virtualised list. The four fields are passed **flat**
 * and not in an object: an object rebuilt on each render would defeat `memo`.
 */
interface Placement {
  index: number;
  start: number;
  /** Real measurement of the row (`virtualizer.measureElement`): height of the reader's text. */
  measure: (node: Element | null) => void;
  /** Moves the keyboard focus from one row to another (arrows). */
  onMove: (from: number, delta: number) => void;
}

const ROW_BASE =
  'group absolute left-0 top-0 flex w-full cursor-default items-center gap-1 rounded py-0.5 pr-1 text-xs';

/** Up/down arrows: the panel scrolls to the targeted row before giving it focus. */
function arrowMove(e: React.KeyboardEvent, index: number, onMove: Placement['onMove']): boolean {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  e.preventDefault();
  onMove(index, e.key === 'ArrowDown' ? 1 : -1);
  return true;
}

export const PrimRow = memo(function PrimRow({
  row,
  index,
  start,
  measure,
  onMove,
  selected,
  locked,
  hidden,
  byAncestor,
  rendered,
  variants,
  onToggle,
  onClick,
  onLock,
  onEye,
}: {
  row: { node: PrimNode; depth: number; open: boolean };
  index: Placement['index'];
  start: Placement['start'];
  measure: Placement['measure'];
  onMove: Placement['onMove'];
  selected: boolean;
  locked: boolean;
  hidden: boolean;
  /** Hidden by an ancestor: restoring it here would have no visible effect. */
  byAncestor: boolean;
  rendered: boolean;
  /** Names of the prim's variant sets, or `null` if it carries none (badge). */
  variants: string | null;
  onToggle: (path: string) => void;
  /** Click on the row: the selection (plain / additive / range) is arbitrated by the panel. */
  onClick: (path: string, e: React.MouseEvent | React.KeyboardEvent) => void;
  onLock: (path: string) => void;
  onEye: (path: string, alt: boolean, hidden: boolean) => void;
}) {
  const t = useT();
  const { node, depth, open } = row;

  return (
    <div
      ref={measure}
      data-index={index}
      data-prim-path={node.path}
      role="button"
      tabIndex={0}
      onClick={(e) => onClick(node.path, e)}
      onKeyDown={(e) => {
        if (arrowMove(e, index, onMove)) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onClick(node.path, e);
      }}
      style={{ transform: `translateY(${start}px)`, paddingLeft: `${depth * 12 + 4}px` }}
      className={`${ROW_BASE} ${selected ? 'bg-primary/20 text-foreground' : 'hover:bg-secondary'} ${
        hidden || !rendered ? 'text-muted-foreground' : 'text-foreground'
      }`}
    >
      {node.children.length > 0 ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path);
          }}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={open ? t('common.collapse') : t('scenegraph.expand')}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="w-3 shrink-0" />
      )}

      <span className="truncate" title={`${node.path}${node.type ? ` · ${node.type}` : ''}`}>
        {node.name}
      </span>
      {variants && (
        <span
          title={variants}
          className="shrink-0 rounded bg-secondary px-1 text-2xs text-secondary-foreground"
        >
          {t('prim.variantShort')}
        </span>
      )}
      <span className="flex-1" />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onLock(node.path);
        }}
        title={locked ? t('scenegraph.unlock') : t('scenegraph.lock')}
        className={`shrink-0 hover:text-foreground ${
          locked ? 'text-foreground' : 'text-muted-foreground opacity-0 group-hover:opacity-100'
        }`}
      >
        {locked ? <Lock size={12} /> : <LockOpen size={12} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          // Alt+click = solo: isolates this prim (everything else is hidden), DCC-style.
          onEye(node.path, e.altKey, hidden);
        }}
        disabled={byAncestor}
        title={
          byAncestor ? t('scenegraph.hiddenByParent') : hidden ? t('common.show') : t('scenegraph.eyeHint')
        }
        className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </div>
  );
});

/** Row of a staging clone (C1): dedicated badge, deletable, without context menu. */
export const CloneRow = memo(function CloneRow({
  path,
  name,
  depth,
  index,
  start,
  measure,
  onMove,
  selected,
  onClick,
  onDelete,
}: {
  path: string;
  name: string;
  depth: number;
  index: Placement['index'];
  start: Placement['start'];
  measure: Placement['measure'];
  onMove: Placement['onMove'];
  selected: boolean;
  onClick: (path: string, e: React.MouseEvent | React.KeyboardEvent) => void;
  onDelete: (path: string) => void;
}) {
  const t = useT();
  return (
    <div
      ref={measure}
      data-index={index}
      role="button"
      tabIndex={0}
      onClick={(e) => onClick(path, e)}
      onKeyDown={(e) => {
        if (arrowMove(e, index, onMove)) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onClick(path, e);
      }}
      style={{ transform: `translateY(${start}px)`, paddingLeft: `${depth * 12 + 4}px` }}
      className={`${ROW_BASE} ${
        selected ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary'
      }`}
    >
      <Copy size={10} className="shrink-0" />
      <span className="truncate italic">{name}</span>
      <span className="shrink-0 rounded bg-secondary px-1 text-2xs text-secondary-foreground">
        {t('prim.cloneBadge')}
      </span>
      <span className="flex-1" />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(path);
        }}
        title={t('common.delete')}
        className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
});
