// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../../../components/ui/context-menu';
import type { UsdBakedVariant, UsdModelInfo } from '../../../types/api';
import { ancestorPaths, flattenTree, searchPrimTree } from '../three/usdScenegraph';
import { isHidden, isHiddenByAncestor } from '../three/sceneOverride';
import type { UsdSceneState } from '../three/useUsdScene';
import PrimMenuItems from './PrimMenuItems';
import { CloneRow, PrimRow } from './ScenegraphRow';
import {
  ROW_ESTIMATE,
  ROW_OVERSCAN,
  aimedPrimPath,
  buildRows,
  rowIndexOf,
  variantTitleIndex,
} from './scenegraphRows';
import { useT } from '../../../i18n';
import { isEditable } from '../../../lib/shortcuts';

/**
 * USD scenegraph of the dock (Phase 46, 46.C/46.E; B1/B2): the real tree of the scene, selection
 * synchronised with the viewer. **Multi-selection** (Ctrl+click toggles, Shift+click takes a range),
 * search, per-prim visibility (Alt+click on the eye = isolate), locking (excluded from viewer picking),
 * and right-click to change a variant.
 *
 * The tree comes from the parser, not from the glTF nodes: it therefore also shows **non-rendered** prims
 * (inactive variant, filtered purpose), displayed greyed out.
 *
 * **Scale (F10)**: a production scene counts thousands of prims, and searching expands them all at once.
 * The tree is therefore flattened into rows (`scenegraphRows`) and then virtualised: only the twenty or
 * so visible rows are mounted. The context menu is **single**: it finds the targeted row on right-click,
 * instead of a Radix instance being mounted per prim.
 */
export default function ScenegraphPanel({
  scene,
  usd,
  baked,
  onRevert,
  onSave,
  saving,
}: {
  scene: UsdSceneState;
  usd: UsdModelInfo | null;
  /** Variant options baked into the GLB: the menu greys out the others (46.P). */
  baked?: readonly UsdBakedVariant[] | null;
  onRevert?: () => void;
  /** Records the staging for everyone: pre-publish and manager only. */
  onSave?: () => void;
  saving?: boolean;
}) {
  const t = useT();
  // Methods extracted from the scene state: the dependency lists then hold the functions themselves,
  // which are stable, and not the object, rebuilt on each render of the viewer.
  const { primary, select, selectMany, isolate, setPrim } = scene;
  // Search and expansion live in the scene state: the dock unmounts this panel as soon as one switches to
  // another tab, and everything restarted collapsed, query cleared.
  const { query, setQuery, expanded, toggle, expand } = scene.view;

  // Search: the filtered tree keeps the ancestors of the results, and `search.expand` only expands the
  // path leading to them. The rest of the tree keeps the fold the user gave it.
  const search = useMemo(() => searchPrimTree(scene.tree, query), [scene.tree, query]);
  const displayTree = search.tree;
  const searching = query.trim().length > 0;
  const rows = useMemo(
    () => buildRows(displayTree, expanded, scene.override, search.expand),
    [displayTree, expanded, scene.override, search.expand],
  );
  const variants = useMemo(() => variantTitleIndex(usd), [usd]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Root of the panel: target of the hover listeners, outside the React flow (see `reveal`).
  const rootRef = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  // The React compiler gives up memoising a component that calls `useVirtualizer`: the virtualizer returns
  // functions bound to mutable state, which would be wrongly frozen. No consequence here: the rows are
  // memoised by hand and only receive values.
  // eslint-disable-next-line react-hooks/incompatible-library -- explicit memoization, see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: ROW_OVERSCAN,
    getItemKey: (index) => rows[index].path,
  });

  /**
   * Selection coming from the viewer: its row may be outside the window. On a virtualised list it does
   * not even exist in the DOM, so no `scrollIntoView` could find it. We therefore scroll by index.
   * `align: 'auto'` does not move when the row is already visible: clicking a row never moves the list
   * under the finger.
   */
  useEffect(() => {
    const index = rowIndexOf(rows, primary);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [primary, rows, virtualizer]);

  /** Up/down arrows: the targeted row may only be mounted on the render following the scroll. */
  const onMove = useCallback(
    (from: number, delta: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, from + delta));
      if (next === from) return;
      virtualizer.scrollToIndex(next, { align: 'auto' });
      const focus = () => scrollRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
      focus();
      requestAnimationFrame(focus);
    },
    [rows.length, virtualizer],
  );

  /** Click on a row: plain = replace, Ctrl = toggle, Shift = range from the primary. */
  const onRowClick = useCallback(
    (path: string, e: React.MouseEvent | React.KeyboardEvent) => {
      if (e.shiftKey && primary && primary !== path) {
        const order = flattenTree(displayTree);
        const a = order.indexOf(primary);
        const b = order.indexOf(path);
        if (a >= 0 && b >= 0) {
          selectMany(order.slice(Math.min(a, b), Math.max(a, b) + 1));
          return;
        }
      }
      select(path, { additive: e.ctrlKey || e.metaKey });
    },
    [displayTree, primary, select, selectMany],
  );

  const onEye = useCallback(
    (path: string, alt: boolean, hiddenNow: boolean) => {
      // Alt+click = solo: isolates this prim (everything else is hidden), DCC-style.
      if (alt) isolate(path);
      else setPrim(path, { visible: hiddenNow ? undefined : false });
    },
    [isolate, setPrim],
  );

  // Single context menu: the targeted row is found on right-click. The targeted prim is also held in a
  // ref, read by `onOpenChange` within the same event: a right-click outside a prim row (empty area, clone
  // row) opens nothing, as before.
  const aimed = useRef<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const onAim = useCallback((e: React.MouseEvent) => {
    aimed.current = aimedPrimPath(e.target);
    setTarget(aimed.current);
  }, []);
  /** Long-press on touch: Radix opens the same menu without going through `contextmenu`. */
  const onTouchAim = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') onAim(e);
    },
    [onAim],
  );

  /**
   * `F` while hovering the panel: **reveal** the selected prim in the tree, instead of framing the
   * camera. Its ancestors are expanded; if it is outside the current filter, the search is lifted,
   * otherwise there would be nothing to show. Scrolling by index above does the rest.
   */
  const reveal = useCallback(() => {
    if (!primary) return;
    if (!flattenTree(displayTree).includes(primary)) setQuery('');
    expand(ancestorPaths(primary));
  }, [primary, displayTree, setQuery, expand]);

  /**
   * Hover + `F`. Two delicate points:
   *  - hover is tracked with **native** listeners (`pointerenter`/`pointerleave`): the keyboard has no
   *    focus in the tree, so the keystroke never passes through this subtree, and no React handler
   *    would see it;
   *  - listening is in **capture on `window`**, whereas the global camera framing (`useFrameShortcuts`)
   *    listens in bubble on the same `window`: the capture runs first, and `stopPropagation` prevents it
   *    from also framing. With no prim selected, the keystroke is let through: the viewer frames as before.
   */
  const empty = scene.tree.length === 0;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const enter = () => {
      hovered.current = true;
    };
    const leave = () => {
      hovered.current = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!hovered.current || e.key.toLowerCase() !== 'f' || !primary) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isEditable(e.target)) return;
      // Same guard as the camera framing: an open dialog takes over the shortcuts.
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      reveal();
    };
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    window.addEventListener('keydown', onKey, true);
    return () => {
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [reveal, primary, empty]);

  if (empty) return <p className="p-2 text-xs text-muted-foreground">{t('review.scenegraph.empty')}</p>;

  return (
    <div ref={rootRef} className="flex max-h-[50vh] flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
        <Search size={11} className="shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('scenegraph.search')}
          aria-label={t('scenegraph.search')}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <ContextMenu open={menuOpen} onOpenChange={(next) => setMenuOpen(next && aimed.current !== null)}>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            onContextMenu={onAim}
            onPointerDown={onTouchAim}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {/* Spacer at the height of the expanded tree: the scrollbar tells the truth about the volume. */}
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                return row.kind === 'clone' ? (
                  <CloneRow
                    key={item.key}
                    path={row.path}
                    name={row.name}
                    depth={row.depth}
                    index={item.index}
                    start={item.start}
                    measure={virtualizer.measureElement}
                    onMove={onMove}
                    selected={scene.selected.includes(row.path)}
                    onClick={onRowClick}
                    onDelete={scene.deleteClone}
                  />
                ) : (
                  <PrimRow
                    key={item.key}
                    row={row}
                    index={item.index}
                    start={item.start}
                    measure={virtualizer.measureElement}
                    onMove={onMove}
                    selected={scene.selected.includes(row.path)}
                    locked={scene.locked.has(row.path)}
                    hidden={isHidden(scene.override, row.path)}
                    byAncestor={isHiddenByAncestor(scene.override, row.path)}
                    rendered={scene.renderedPaths.has(row.path)}
                    variants={variants.get(row.path) ?? null}
                    onToggle={toggle}
                    onClick={onRowClick}
                    onLock={scene.toggleLock}
                    onEye={onEye}
                  />
                );
              })}
            </div>
            {searching && rows.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">{t('scenegraph.noMatch')}</p>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {target && <PrimMenuItems scene={scene} usd={usd} baked={baked} path={target} />}
        </ContextMenuContent>
      </ContextMenu>
      {usd?.primsTruncated && (
        <p className="px-2 py-1 text-2xs text-muted-foreground">{t('review.scenegraph.truncated')}</p>
      )}
      {scene.dirty && (
        <div className="flex items-center gap-3 border-t border-border px-2 py-1">
          {onRevert && (
            <button
              onClick={onRevert}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw size={11} /> {t('common.undo')}
            </button>
          )}
          <span className="flex-1" />
          {onSave ? (
            <button
              onClick={onSave}
              disabled={saving}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('scenegraph.saveForAll')}
            </button>
          ) : (
            // After publication, the shared staging is frozen: changes only go out in a comment.
            <span className="text-xs text-muted-foreground">{t('review.attachedToComment')}</span>
          )}
        </div>
      )}
    </div>
  );
}
