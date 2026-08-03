// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../../../components/ui/context-menu';
import type { UsdBakedVariant, UsdModelInfo } from '../../../types/api';
import type { PrimNode } from '../three/usdScenegraph';
import { isHidden, isHiddenByAncestor } from '../three/sceneOverride';
import type { UsdSceneState } from '../three/useUsdScene';
import PrimMenuItems from './PrimMenuItems';
import { useT } from '../../../i18n';

/**
 * Scenegraph USD du dock (Phase 46, 46.C/46.E) : l'arbre réel de la scène, sélection
 * synchronisée avec le viewer, visibilité par prim et clic droit pour changer une variante.
 *
 * L'arbre vient de l'analyseur, pas des nœuds glTF : il montre donc aussi les prims **non
 * rendus** (variante inactive, purpose filtré), affichés en grisé. C'est la différence entre
 * un vrai scenegraph et la liste de ce qui est à l'écran.
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
}: {
  node: PrimNode;
  depth: number;
  scene: UsdSceneState;
  usd: UsdModelInfo | null;
  baked?: readonly UsdBakedVariant[] | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const t = useT();
  const open = expanded.has(node.path);
  const hidden = isHidden(scene.override, node.path);
  const byAncestor = isHiddenByAncestor(scene.override, node.path);
  const rendered = scene.renderedPaths.has(node.path);
  const sets = variantSetsOf(usd, node.path);
  const isSelected = scene.selected === node.path;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={() => scene.select(node.path)}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            className={`flex cursor-default items-center gap-1 rounded py-0.5 pr-1 text-xs ${
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
                var
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                scene.setPrim(node.path, { visible: hidden ? undefined : false });
              }}
              // Masqué par un ancêtre : le rétablir ici n'aurait aucun effet visible.
              disabled={byAncestor}
              title={
                byAncestor ? t('scenegraph.hiddenByParent') : hidden ? t('common.show') : t('common.hide')
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

  if (scene.tree.length === 0)
    return <p className="p-2 text-xs text-muted-foreground">{t('review.scenegraph.empty')}</p>;

  return (
    <div className="flex max-h-[50vh] flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {scene.tree.map((node) => (
          <PrimRow
            key={node.path}
            node={node}
            depth={0}
            scene={scene}
            usd={usd}
            baked={baked}
            expanded={expanded}
            onToggle={toggle}
          />
        ))}
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
              {saving ? 'Enregistrement…' : t('scenegraph.saveForAll')}
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
