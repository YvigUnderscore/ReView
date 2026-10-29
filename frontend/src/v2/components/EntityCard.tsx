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

/** Multi-selection state of a card (13.A). */
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
  /** Action buttons (edit/delete…) visible on hover. */
  actions?: EntityItemAction[];
  /** Multi-selection: shows a tickable checkbox (on hover or when ticked). */
  selection?: EntitySelection;
  /** Context-menu actions (right click). */
  contextActions?: EntityItemAction[];
  /**
   * Declarative menu entries, for what `EntityItemAction` cannot express,
   * for example a radio group of statuses. They are placed before the actions.
   */
  contextEntries?: MenuEntry[];
  /** Pinning to favorites (42.A3, №71): injects the "pin" action on right click, plus a star. */
  favorite?: { type: FavType; entityId: number };
  /** Animated preview on hover (42.A, №78): thumbnail sprite (cards view). */
  hoverSprite?: SpriteData | null;
  /**
   * What the card says about the entity beyond its name: description, the faces of
   * those responsible, review wait, last modification. Absent = older card.
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

/** Selection checkbox: captures the modifiers (Shift/Ctrl) and neutralizes navigation. */
function SelectBox({ selection, className }: { selection: EntitySelection; className?: string }) {
  const t = useT();
  // The inner checkbox is inert (tabIndex -1): this container carries the interaction,
  // keyboard included, since modifiers can be read from a keyboard event too.
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

/** Card or compact row depending on `view`. Clickable via `to` (link) or `onClick`. */
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
  /**
   * Three border states, in this order of priority.
   *
   * Selection and the current card take precedence over "unviewed": a ticked card
   * must read as ticked, otherwise a mass action would apply to what one believes to have
   * deselected. "Unviewed" therefore does not borrow `primary`: it takes `info`, which
   * has no other use on a card, and the ring stays more discreet than that of the
   * selection: it is an invitation to look, not a state one has chosen.
   */
  const activeRing = highlighted
    ? 'border-primary ring-1 ring-primary'
    : meta?.unseen
      ? 'border-info ring-1 ring-info/40 shadow-md shadow-info/20'
      : 'border-border';
  const clickable = onClick ? 'cursor-pointer text-left w-full' : '';

  // Favorites (42.A3): right-click action "pin/unpin" plus a star indicator.
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

  // Card view: light "hover lift" (disabled if prefers-reduced-motion)
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
 * Entrance delay of the last animated card, in rows of 30 ms.
 *
 * Beyond that, they all leave together: a page of a hundred cards scrolled into view by the sentinel
 * spread its entrance over three seconds, and the cards at the bottom finished appearing
 * well after reading had begun. Twelve is what a wide screen shows.
 */
const STAGGER_RANKS = 12;

/** Adaptive container: grid in cards mode (cascading entrance), stack in compact mode. */
export function EntityContainer({ view, children }: { view: ViewMode; children: ReactNode }) {
  if (view !== 'cards') return <div className="space-y-1.5">{children}</div>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Children.toArray(children).map((child, i) => (
        // Key taken from the child (`key={shot.id}` in the caller), never the index:
        // keyed by position, the wrapper changed card at the slightest filter, React
        // reused the neighbour's node and replayed the fade on cards already there.
        <div
          key={isValidElement(child) ? child.key : i}
          className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200 fill-mode-backwards motion-reduce:animate-none"
          style={{
            animationDelay: `${Math.min(i, STAGGER_RANKS) * 30}ms`,
            // Same curve as the former transition (soft ease-out): the entrance has
            // moved from the JS animation engine to a CSS animation, identically.
            animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

/** Ready-made action icons. */
export const EditIcon = <Pencil size={14} />;
export const DeleteIcon = <Trash2 size={14} />;

/**
 * Memoized: a list of entities goes up to two thousand, each with its Radix context
 * menu, its checkbox and its hover preview. Ticking a checkbox must only re-render
 * the ticked card, provided the caller passes it stable props
 * (cf. `pages/reviews/ReviewCard`, which holds the page's memoization boundary).
 */
export default memo(EntityCard);
