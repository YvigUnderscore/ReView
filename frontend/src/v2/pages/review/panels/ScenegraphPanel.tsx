// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../../../components/ui/context-menu';
import type { UsdBakedVariant, UsdModelInfo } from '../../../types/api';
import { filterPrimTree, flattenTree, type PrimNode } from '../three/usdScenegraph';
import { clonePath, clonesOf, isHidden, isHiddenByAncestor } from '../three/sceneOverride';
import type { UsdSceneState } from '../three/useUsdScene';
import PrimMenuItems from './PrimMenuItems';
import { useT } from '../../../i18n';

/**
 * Scenegraph USD du dock (Phase 46, 46.C/46.E ; B1/B2) : l'arbre réel de la scène, sélection
 * synchronisée avec le viewer — **multi-sélection** (Ctrl+clic bascule, Maj+clic plage),
 * recherche, visibilité par prim (Alt+clic sur l'œil = isoler), verrouillage (exclu du picking
 * viewer) et clic droit pour changer une variante.
 *
 * L'arbre vient de l'analyseur, pas des nœuds glTF : il montre donc aussi les prims **non
 * rendus** (variante inactive, purpose filtré), affichés en grisé.
 */

/** Un prim porteur de variantes dans la scène analysée. */
const variantSetsOf = (usd: UsdModelInfo | null, prim: string) =>
  (usd?.variantSets ?? []).filter((v) => v.prim === prim);

function PrimRow({
  node,
  depth,
  scene,
  usd,
  baked,
  expanded,
  onToggle,
  onRowClick,
}: {
  node: PrimNode;
  depth: number;
  scene: UsdSceneState;
  usd: UsdModelInfo | null;
  baked?: readonly UsdBakedVariant[] | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  /** Clic sur la rangée — la sélection (simple/additive/plage) est arbitrée par le panneau. */
  onRowClick: (path: string, e: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  const t = useT();
  const open = expanded.has(node.path);
  const hidden = isHidden(scene.override, node.path);
  const byAncestor = isHiddenByAncestor(scene.override, node.path);
  const rendered = scene.renderedPaths.has(node.path);
  const sets = variantSetsOf(usd, node.path);
  const isSelected = scene.selected.includes(node.path);
  const locked = scene.locked.has(node.path);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => onRowClick(node.path, e)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onRowClick(node.path, e);
            }}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            className={`group flex cursor-default items-center gap-1 rounded py-0.5 pr-1 text-xs ${
              isSelected ? 'bg-primary/20 text-foreground' : 'hover:bg-secondary'
            } ${hidden || !rendered ? 'text-muted-foreground' : 'text-foreground'}`}
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
            {sets.length > 0 && (
              <span
                title={sets.map((s) => s.name).join(', ')}
                className="shrink-0 rounded bg-secondary px-1 text-[9px] text-secondary-foreground"
              >
                {t('prim.variantShort')}
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                scene.toggleLock(node.path);
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
                // Alt+clic = solo : isole ce prim (tout le reste est masqué) — façon DCC.
                if (e.altKey) scene.isolate(node.path);
                else scene.setPrim(node.path, { visible: hidden ? undefined : false });
              }}
              // Masqué par un ancêtre : le rétablir ici n'aurait aucun effet visible.
              disabled={byAncestor}
              title={
                byAncestor
                  ? t('scenegraph.hiddenByParent')
                  : hidden
                    ? t('common.show')
                    : t('scenegraph.eyeHint')
              }
              className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <PrimMenuItems scene={scene} usd={usd} baked={baked} path={node.path} />
        </ContextMenuContent>
      </ContextMenu>

      {/* Clones de mise en scène du prim (C1) : rangées filles, badge dédié, supprimables. */}
      {clonesOf(scene.override, node.path).map((clone) => {
        const pseudo = clonePath(node.path, clone.id);
        const cloneSelected = scene.selected.includes(pseudo);
        return (
          <div
            key={pseudo}
            role="button"
            tabIndex={0}
            onClick={(e) => scene.select(pseudo, { additive: e.ctrlKey || e.metaKey })}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              scene.select(pseudo, { additive: e.ctrlKey || e.metaKey });
            }}
            style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
            className={`group flex cursor-default items-center gap-1 rounded py-0.5 pr-1 text-xs ${
              cloneSelected ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            <Copy size={10} className="shrink-0" />
            <span className="truncate italic">{node.name}</span>
            <span className="shrink-0 rounded bg-secondary px-1 text-[9px] text-secondary-foreground">
              {t('prim.cloneBadge')}
            </span>
            <span className="flex-1" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                scene.deleteClone(pseudo);
              }}
              title={t('common.delete')}
              className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}

      {open &&
        node.children.map((child) => (
          <PrimRow
            key={child.path}
            node={child}
            depth={depth + 1}
            scene={scene}
            usd={usd}
            baked={baked}
            expanded={expanded}
            onToggle={onToggle}
            onRowClick={onRowClick}
          />
        ))}
    </>
  );
}

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
  const [query, setQuery] = useState('');
  // Les deux premiers niveaux ouverts : assez pour situer la scène sans noyer l'utilisateur.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(scene.tree.flatMap((n) => [n.path, ...n.children.map((c) => c.path)])),
  );
  const toggle = (path: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Recherche : l'arbre filtré garde les ancêtres des résultats ; tout est déplié pendant
  // qu'une requête est active (sinon un résultat resterait caché sous un nœud replié).
  const displayTree = useMemo(() => filterPrimTree(scene.tree, query), [scene.tree, query]);
  const searching = query.trim().length > 0;

  /** Clic sur une rangée : simple = remplace, Ctrl = bascule, Maj = plage depuis le primaire. */
  const onRowClick = (path: string, e: React.MouseEvent | React.KeyboardEvent) => {
    if (e.shiftKey && scene.primary && scene.primary !== path) {
      const order = flattenTree(displayTree);
      const a = order.indexOf(scene.primary);
      const b = order.indexOf(path);
      if (a >= 0 && b >= 0) {
        scene.selectMany(order.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    scene.select(path, { additive: e.ctrlKey || e.metaKey });
  };

  if (scene.tree.length === 0)
    return <p className="p-2 text-xs text-muted-foreground">{t('review.scenegraph.empty')}</p>;

  return (
    <div className="flex max-h-[50vh] flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
        <Search size={11} className="shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('scenegraph.search')}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {displayTree.map((node) => (
          <PrimRow
            key={node.path}
            node={node}
            depth={0}
            scene={scene}
            usd={usd}
            baked={baked}
            expanded={searching ? new Set(flattenTree(displayTree)) : expanded}
            onToggle={toggle}
            onRowClick={onRowClick}
          />
        ))}
        {searching && displayTree.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">{t('scenegraph.noMatch')}</p>
        )}
      </div>
      {usd?.primsTruncated && (
        <p className="px-2 py-1 text-[10px] text-muted-foreground">{t('review.scenegraph.truncated')}</p>
      )}
      {scene.dirty && (
        <div className="flex items-center gap-3 border-t border-border px-2 py-1">
          {onRevert && (
            <button
              onClick={onRevert}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw size={11} /> {t('common.undo')}
            </button>
          )}
          <span className="flex-1" />
          {onSave ? (
            <button
              onClick={onSave}
              disabled={saving}
              className="text-[11px] text-primary hover:underline disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('scenegraph.saveForAll')}
            </button>
          ) : (
            // Après publication, la mise en scène commune est figée : les modifications ne
            // partent plus que dans un commentaire.
            <span className="text-[11px] text-muted-foreground">{t('review.attachedToComment')}</span>
          )}
        </div>
      )}
    </div>
  );
}
