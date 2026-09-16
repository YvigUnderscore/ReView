// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { Children, isValidElement, memo, type ReactNode } from 'react';
import type { ViewMode } from '../stores/useViewPref';
import type { SelectModifiers } from '../lib/useMultiSelect';
import { useFavorites, type FavType } from '../stores/useFavorites';
import HoverSprite, { type SpriteData } from './HoverSprite';
import { Checkbox } from './ui/checkbox';
import EntityContextMenu from './ui/entity-menu';
import { toMenuEntries, type EntityItemAction, type MenuEntry } from '../lib/menuSpec';
import EntityCardMeta, { MetaDescription, type EntityMeta } from './entity/EntityCardMeta';
import EntityThumb from './entity/EntityThumb';
import { useT } from '../i18n';

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
  /**
   * Entrées de menu déclaratives, pour ce que `EntityItemAction` ne sait pas exprimer —
   * un groupe radio de statuts, par exemple. Elles se placent avant les actions.
   */
  contextEntries?: MenuEntry[];
  /** Épinglage aux favoris (42.A3 — №71) : injecte l'action « épingler » au clic droit + étoile. */
  favorite?: { type: FavType; entityId: number };
  /** Aperçu animé au survol (42.A — №78) : sprite de miniatures (vue cartes). */
  hoverSprite?: SpriteData | null;
  /**
   * Ce que la carte dit de l'entité au-delà de son nom : description, visages des
   * responsables, attente de review, dernière modification. Absent = carte d'avant.
   */
  meta?: EntityMeta;
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
          disabled={a.disabled}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            a.onClick?.();
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
  const t = useT();
  // La case interne est inerte (tabIndex -1) : c'est ce conteneur qui porte l'interaction,
  // clavier compris — les modificateurs se lisent aussi bien sur un événement clavier.
  const select = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
    selection.onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${className ?? ''} ${
        selection.selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      } transition-opacity`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        select(e);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        select(e);
      }}
    >
      <Checkbox
        checked={selection.selected}
        onCheckedChange={() => {}}
        tabIndex={-1}
        aria-label={t('common.select')}
      />
    </div>
  );
}

/** Carte ou ligne compacte selon `view`. Cliquable via `to` (lien) ou `onClick`. */
function EntityCard({
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
  contextEntries,
  favorite,
  hoverSprite,
  meta,
}: EntityCardProps) {
  const t = useT();
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
          label: isFav ? t('favorites.remove') : t('favorites.pin'),
          onClick: () => void toggleFav(favorite.type, favorite.entityId),
        },
      ]
    : [];
  const menuActions = [...favAction, ...(contextActions ?? [])];
  const menuEntries = [...(contextEntries ?? []), ...toMenuEntries(menuActions)];
  const favStar =
    favorite && isFav ? (
      <Star
        size={13}
        className="shrink-0 text-warning"
        fill="currentColor"
        aria-label={t('favorites.pinned')}
      />
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

    if (!menuEntries.length) return node;
    return <EntityContextMenu entries={menuEntries}>{node}</EntityContextMenu>;
  };

  if (view === 'compact') {
    return wrap(
      <div
        className={`group flex items-center gap-3 rounded-md border ${activeRing} bg-card px-3 py-2 transition-colors hover:border-primary ${clickable}`}
      >
        {selection && <SelectBox selection={selection} />}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary/60">
          <EntityThumb url={thumbnailUrl} name={title} variant="mini" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {favStar}
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          {/* La description n'a droit qu'à une ligne en compact : la ligne EST la carte. */}
          {meta?.description && (
            <div className="truncate text-2xs text-muted-foreground">{meta.description}</div>
          )}
        </div>
        {meta && <EntityCardMeta meta={meta} compact />}
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
        {/* Sans miniature, la carte porte le nom : c'est ce qu'on cherche du regard, et
            cent icônes d'image identiques ne le disaient pas. */}
        <EntityThumb url={thumbnailUrl} name={title} />
        {hoverSprite && hoverSprite.count > 0 && <HoverSprite sprite={hoverSprite} />}
        {selection && <SelectBox selection={selection} className="absolute left-1.5 top-1.5" />}
        <div className="absolute right-1.5 top-1.5">
          <Actions actions={actions} />
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {favStar}
              <span className="truncate text-sm font-medium">{title}</span>
            </div>
            {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          </div>
          {badge}
        </div>
        {meta?.description && (
          <div className="mt-1.5">
            <MetaDescription text={meta.description} />
          </div>
        )}
        {meta && <EntityCardMeta meta={meta} />}
      </div>
    </div>,
  );
}

/**
 * Retard d'apparition de la dernière carte animée, en rangs de 30 ms.
 *
 * Au-delà, toutes partent ensemble : une page de cent cartes descendue par la sentinelle
 * étalait son entrée sur trois secondes, et les cartes du bas finissaient d'apparaître
 * bien après qu'on ait commencé à lire. Douze, c'est ce qu'un écran large affiche.
 */
const STAGGER_RANKS = 12;

/** Conteneur adaptatif : grille en mode cartes (apparition en cascade), pile en mode compact. */
export function EntityContainer({ view, children }: { view: ViewMode; children: ReactNode }) {
  if (view !== 'cards') return <div className="space-y-1.5">{children}</div>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Children.toArray(children).map((child, i) => (
        // Clé reprise de l'enfant (`key={shot.id}` chez l'appelant), jamais l'index :
        // keyée par position, l'enveloppe changeait de carte au moindre filtre, React
        // réutilisait le nœud de la voisine et rejouait le fondu sur des cartes déjà là.
        <div
          key={isValidElement(child) ? child.key : i}
          className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200 fill-mode-backwards motion-reduce:animate-none"
          style={{
            animationDelay: `${Math.min(i, STAGGER_RANKS) * 30}ms`,
            // Même courbe que l'ancienne transition (ease-out doux) : l'apparition est
            // passée du moteur d'animation JS à une animation CSS, à l'identique.
            animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

/** Icônes d'action prêtes à l'emploi. */
export const EditIcon = <Pencil size={14} />;
export const DeleteIcon = <Trash2 size={14} />;

/**
 * Mémoïsée : une liste d'entités en monte jusqu'à deux mille, chacune avec son menu
 * contextuel Radix, sa case et son aperçu au survol. Cocher une case ne doit re-rendre
 * que la carte cochée — encore faut-il que l'appelant lui passe des props stables
 * (cf. `pages/reviews/ReviewCard`, qui porte la frontière de mémoïsation de la page).
 */
export default memo(EntityCard);
