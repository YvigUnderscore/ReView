// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo } from 'react';
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import type { PrimNode } from '../three/usdScenegraph';
import { useT } from '../../../i18n';

/**
 * Une rangée du scenegraph virtualisé — positionnée en absolu dans la cale du virtualiseur.
 *
 * Elle ne reçoit que des valeurs déjà décidées (drapeaux, libellés) et des fonctions stables :
 * c'est ce qui rend `memo` efficace, et donc ce qui évite de rejouer les vingt rangées montées
 * à chaque événement de défilement. Elle ne monte **aucun** menu contextuel : le panneau n'en
 * tient plus qu'un seul, qui retrouve la rangée visée au clic droit (`data-prim-path`).
 */

/**
 * Position et mesure d'une rangée dans la liste virtualisée. Les quatre champs sont passés
 * **à plat** et non dans un objet : un objet reconstruit à chaque rendu ferait échouer `memo`.
 */
interface Placement {
  index: number;
  start: number;
  /** Mesure réelle de la rangée (`virtualizer.measureElement`) — hauteur du texte du lecteur. */
  measure: (node: Element | null) => void;
  /** Déplacement du focus clavier d'une rangée à l'autre (flèches). */
  onMove: (from: number, delta: number) => void;
}

const ROW_BASE =
  'group absolute left-0 top-0 flex w-full cursor-default items-center gap-1 rounded py-0.5 pr-1 text-xs';

/** Flèches haut/bas : le panneau défile jusqu'à la rangée visée avant de lui donner le focus. */
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
  /** Masqué par un ancêtre : le rétablir ici n'aurait aucun effet visible. */
  byAncestor: boolean;
  rendered: boolean;
  /** Noms des jeux de variantes du prim, ou `null` s'il n'en porte pas (badge). */
  variants: string | null;
  onToggle: (path: string) => void;
  /** Clic sur la rangée — la sélection (simple/additive/plage) est arbitrée par le panneau. */
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
          // Alt+clic = solo : isole ce prim (tout le reste est masqué) — façon DCC.
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

/** Rangée d'un clone de mise en scène (C1) : badge dédié, supprimable, sans menu contextuel. */
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
