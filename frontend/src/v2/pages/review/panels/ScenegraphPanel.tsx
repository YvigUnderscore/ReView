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
 * Scenegraph USD du dock (Phase 46, 46.C/46.E ; B1/B2) : l'arbre réel de la scène, sélection
 * synchronisée avec le viewer — **multi-sélection** (Ctrl+clic bascule, Maj+clic plage),
 * recherche, visibilité par prim (Alt+clic sur l'œil = isoler), verrouillage (exclu du picking
 * viewer) et clic droit pour changer une variante.
 *
 * L'arbre vient de l'analyseur, pas des nœuds glTF : il montre donc aussi les prims **non
 * rendus** (variante inactive, purpose filtré), affichés en grisé.
 *
 * **Échelle (F10)** : une scène de production compte des milliers de prims, et chercher les
 * déplie tous d'un coup. L'arbre est donc aplati en rangées (`scenegraphRows`) puis virtualisé —
 * seule la vingtaine de rangées visibles est montée — et le menu contextuel est **unique** : il
 * retrouve la rangée visée au clic droit, au lieu qu'une instance Radix soit montée par prim.
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
  /** Options de variantes cuites dans le GLB — le menu grise les autres (46.P). */
  baked?: readonly UsdBakedVariant[] | null;
  onRevert?: () => void;
  /** Enregistre la mise en scène pour tous — prépublish et gestionnaire uniquement. */
  onSave?: () => void;
  saving?: boolean;
}) {
  const t = useT();
  // Méthodes extraites de l'état de scène : les listes de dépendances portent alors sur les
  // fonctions elles-mêmes — stables — et non sur l'objet, reconstruit à chaque rendu du viewer.
  const { primary, select, selectMany, isolate, setPrim } = scene;
  // Recherche et dépliage vivent dans l'état de scène : le dock démonte ce panneau dès qu'on
  // passe sur un autre onglet, et tout repartait replié, requête effacée.
  const { query, setQuery, expanded, toggle, expand } = scene.view;

  // Recherche : l'arbre filtré garde les ancêtres des résultats, et `search.expand` ne déplie
  // que le chemin qui y mène — le reste de l'arbre garde le pli que l'utilisateur lui a donné.
  const search = useMemo(() => searchPrimTree(scene.tree, query), [scene.tree, query]);
  const displayTree = search.tree;
  const searching = query.trim().length > 0;
  const rows = useMemo(
    () => buildRows(displayTree, expanded, scene.override, search.expand),
    [displayTree, expanded, scene.override, search.expand],
  );
  const variants = useMemo(() => variantTitleIndex(usd), [usd]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Racine du panneau : cible des écouteurs de survol, hors du flux React (voir `reveal`).
  const rootRef = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  // Le compilateur React renonce à mémoïser un composant qui appelle `useVirtualizer` : le
  // virtualiseur rend des fonctions liées à un état mutable, qu'on figerait à tort. Sans
  // conséquence ici — les rangées sont mémoïsées à la main et ne reçoivent que des valeurs.
  // eslint-disable-next-line react-hooks/incompatible-library -- mémoïsation explicite, cf. ci-dessus
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: ROW_OVERSCAN,
    getItemKey: (index) => rows[index].path,
  });

  /**
   * Sélection venue du viewer : sa rangée peut être hors fenêtre — sur une liste virtualisée
   * elle n'existe même pas dans le DOM, aucun `scrollIntoView` ne la trouverait. On défile donc
   * par index. `align: 'auto'` ne bouge pas quand la rangée est déjà visible : cliquer une
   * rangée ne déplace jamais la liste sous le doigt.
   */
  useEffect(() => {
    const index = rowIndexOf(rows, primary);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [primary, rows, virtualizer]);

  /** Flèches haut/bas : la rangée visée peut n'être montée qu'au rendu suivant le défilement. */
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

  /** Clic sur une rangée : simple = remplace, Ctrl = bascule, Maj = plage depuis le primaire. */
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
      // Alt+clic = solo : isole ce prim (tout le reste est masqué) — façon DCC.
      if (alt) isolate(path);
      else setPrim(path, { visible: hiddenNow ? undefined : false });
    },
    [isolate, setPrim],
  );

  // Menu contextuel unique : la rangée visée est retrouvée au clic droit. Le prim visé est
  // aussi tenu dans une ref, lue par `onOpenChange` dans le même événement — un clic droit
  // hors d'une rangée de prim (zone vide, rangée de clone) n'ouvre rien, comme avant.
  const aimed = useRef<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const onAim = useCallback((e: React.MouseEvent) => {
    aimed.current = aimedPrimPath(e.target);
    setTarget(aimed.current);
  }, []);
  /** Appui long tactile : Radix ouvre le même menu sans passer par `contextmenu`. */
  const onTouchAim = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') onAim(e);
    },
    [onAim],
  );

  /**
   * `F` au survol du panneau : **révéler** le prim sélectionné dans l'arbre, au lieu de cadrer
   * la caméra. On déplie ses ancêtres ; s'il est hors du filtre courant, la recherche est levée,
   * sans quoi il n'y aurait rien à montrer. Le défilement par index ci-dessus fait le reste.
   */
  const reveal = useCallback(() => {
    if (!primary) return;
    if (!flattenTree(displayTree).includes(primary)) setQuery('');
    expand(ancestorPaths(primary));
  }, [primary, displayTree, setQuery, expand]);

  /**
   * Survol + `F`. Deux points délicats :
   *  - le survol se relève avec des écouteurs **natifs** (`pointerenter`/`pointerleave`) : le
   *    clavier n'a pas de focus dans l'arbre, la frappe ne traverse donc jamais ce sous-arbre
   *    et aucun gestionnaire React ne la verrait ;
   *  - l'écoute est en **capture sur `window`**, alors que le cadrage caméra global
   *    (`useFrameShortcuts`) écoute en bulle sur le même `window` : la capture passe d'abord, et
   *    `stopPropagation` l'empêche de cadrer en plus. Sans prim sélectionné, on laisse filer —
   *    le viewer cadre comme avant.
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
      // Même garde que le cadrage caméra : un dialogue ouvert prend la main sur les raccourcis.
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
            {/* Cale à la hauteur de l'arbre déplié : l'ascenseur dit la vérité sur le volume. */}
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
            // Après publication, la mise en scène commune est figée : les modifications ne
            // partent plus que dans un commentaire.
            <span className="text-xs text-muted-foreground">{t('review.attachedToComment')}</span>
          )}
        </div>
      )}
    </div>
  );
}
