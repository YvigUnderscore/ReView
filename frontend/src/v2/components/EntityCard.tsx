import { Link } from 'react-router-dom';
import { Image as ImageIcon, Pencil, Star, Trash2 } from 'lucide-react';
import { Children, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ViewMode } from '../stores/useViewPref';
import { staggerContainer, fadeInUp } from '../lib/motion';
import type { SelectModifiers } from '../lib/useMultiSelect';
import { useFavorites, type FavType } from '../stores/useFavorites';
import HoverSprite, { type SpriteData } from './HoverSprite';
import { Checkbox } from './ui/checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';

export interface EntityItemAction {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** État de multi-sélection d'une carte (13.A). */
export interface EntitySelection {
  selected: boolean;
  onSelect: (mods: SelectModifiers) => void;
}

export interface EntityCardProps {
  to?: string;
  onClick?: () => void;
  active?: boolean;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  thumbnailUrl?: string | null;
  view: ViewMode;
  /** Boutons d'action (édition/suppression…) visibles au survol. */
  actions?: EntityItemAction[];
  /** Multi-sélection : affiche une case cochable (survol ou cochée). */
  selection?: EntitySelection;
  /** Actions du menu contextuel (clic droit). */
  contextActions?: EntityItemAction[];
  /** Épinglage aux favoris (42.A3 — №71) : injecte l'action « épingler » au clic droit + étoile. */
  favorite?: { type: FavType; entityId: number };
  /** Aperçu animé au survol (42.A — №78) : sprite de miniatures (vue cartes). */
  hoverSprite?: SpriteData | null;
}

function Actions({ actions }: { actions?: EntityItemAction[] }) {
  if (!actions?.length) return null;
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {actions.map((a) => (
        <button
          key={a.label}
          title={a.label}
          aria-label={a.label}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            a.onClick();
          }}
          className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-secondary ${
            a.danger ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

/** Case de sélection : capte les modificateurs (Shift/Ctrl) et neutralise la navigation. */
function SelectBox({ selection, className }: { selection: EntitySelection; className?: string }) {
  return (
    <div
      className={`${className ?? ''} ${
        selection.selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      } transition-opacity`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        selection.onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
      }}
    >
      <Checkbox
        checked={selection.selected}
        onCheckedChange={() => {}}
        tabIndex={-1}
        aria-label="Sélectionner"
      />
    </div>
  );
}

/** Carte ou ligne compacte selon `view`. Cliquable via `to` (lien) ou `onClick`. */
export default function EntityCard({
  to,
  onClick,
  active,
  title,
  subtitle,
  badge,
  thumbnailUrl,
  view,
  actions,
  selection,
  contextActions,
  favorite,
  hoverSprite,
}: EntityCardProps) {
  const highlighted = active || selection?.selected;
  const activeRing = highlighted ? 'border-primary ring-1 ring-primary' : 'border-border';
  const clickable = onClick ? 'cursor-pointer text-left w-full' : '';

  // Favoris (42.A3) : action clic droit « épingler/retirer » + indicateur étoile.
  const isFav = useFavorites((s) => (favorite ? s.isFav(favorite.type, favorite.entityId) : false));
  const toggleFav = useFavorites((s) => s.toggle);
  const favAction: EntityItemAction[] = favorite
    ? [
        {
          icon: <Star size={14} fill={isFav ? 'currentColor' : 'none'} />,
          label: isFav ? 'Retirer des favoris' : 'Épingler aux favoris',
          onClick: () => void toggleFav(favorite.type, favorite.entityId),
        },
      ]
    : [];
  const menuActions = [...favAction, ...(contextActions ?? [])];
  const favStar =
    favorite && isFav ? (
      <Star size={13} className="shrink-0 text-warning" fill="currentColor" aria-label="Favori" />
    ) : null;

  const wrap = (inner: ReactNode) => {
    let node: ReactNode;
    if (to) node = <Link to={to}>{inner}</Link>;
    else if (onClick)
      node = (
        <button type="button" onClick={onClick} className="block w-full text-left">
          {inner}
        </button>
      );
    else node = inner;

    if (!menuActions.length) return node;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{node}</ContextMenuTrigger>
        <ContextMenuContent>
          {menuActions.map((a) => (
            <ContextMenuItem key={a.label} danger={a.danger} onSelect={() => a.onClick()}>
              {a.icon}
              {a.label}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  if (view === 'compact') {
    return wrap(
      <div
        className={`group flex items-center gap-3 rounded-md border ${activeRing} bg-card px-3 py-2 transition-colors hover:border-primary ${clickable}`}
      >
        {selection && <SelectBox selection={selection} />}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary/60">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon size={14} className="text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {favStar}
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {badge}
        <Actions actions={actions} />
      </div>,
    );
  }

  // Vue cartes — léger « hover lift » (désactivé si prefers-reduced-motion)
  return wrap(
    <div
      className={`group overflow-hidden rounded-lg border ${activeRing} bg-card transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-colors`}
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-secondary/40">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon size={28} className="text-muted-foreground/50" />
        )}
        {hoverSprite && hoverSprite.count > 0 && <HoverSprite sprite={hoverSprite} />}
        {selection && <SelectBox selection={selection} className="absolute left-1.5 top-1.5" />}
        <div className="absolute right-1.5 top-1.5">
          <Actions actions={actions} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {favStar}
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {badge}
      </div>
    </div>,
  );
}

/** Conteneur adaptatif : grille en mode cartes (apparition en cascade), pile en mode compact. */
export function EntityContainer({ view, children }: { view: ViewMode; children: ReactNode }) {
  const reduce = useReducedMotion();
  if (view !== 'cards') return <div className="space-y-1.5">{children}</div>;
  const gridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
  // Reduced-motion : rendu statique, aucune animation.
  if (reduce) return <div className={gridClass}>{children}</div>;
  return (
    <motion.div className={gridClass} variants={staggerContainer} initial="hidden" animate="show">
      {Children.map(children, (child, i) => (
        <motion.div key={i} variants={fadeInUp}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}

/** Icônes d'action prêtes à l'emploi. */
export const EditIcon = <Pencil size={14} />;
export const DeleteIcon = <Trash2 size={14} />;
