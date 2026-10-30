// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Bell, BellOff, ExternalLink, FolderOpen, Link2, Settings2, Trash2 } from 'lucide-react';
import { entriesOf, separator, type EntityItemAction, type MenuEntry } from '../../lib/menuSpec';
import type { MessageKey } from '../../i18n';

/**
 * Single menu for the entity cards of a project: sequences, shots, assets.
 *
 * Two systems coexisted: per-tab action tables (`shotCardActions`, `assetCardActions`) and, beside
 * them, the entries produced by the menu hooks. Each tab composed its own version, hence three
 * vocabularies for three identical gestures: "Edit" here and "Settings" there, "Delete" here and
 * "Move to trash" there, pinning in fifth position on one screen and last on another. Right-click
 * being the product's main route, this drift makes one doubt what one is triggering.
 *
 * Everything is now described here, as data: the order is the same whatever the type of entity,
 * and a missing entry (watching a sequence, omission outside a shot) does not shift the others.
 * Four blocks:
 *
 * 1. **open**: the card's destination;
 * 2. **entity state**: status, assignment, people, omission, visibility, as the hooks produce them;
 * 3. **personal tracking and external link**: pinning to favourites is inserted at the head of this
 *    block, `EntityCard` setting it itself from its `favorite` prop;
 * 4. **management**: settings, linking, trash, last because destructive.
 *
 * The vocabulary follows what the action actually does: `DELETE /api/{shots,assets,
 * sequences}/:id` is a `softDelete`, so the entity goes to the trash and can be restored. Hence
 * "Move to trash", never "Delete". The pencil opens the settings panel, hence "Settings", never
 * "Edit".
 */

export type EntityMenuKind = 'sequence' | 'shot' | 'asset';

/** Entries produced by the menu hooks, inserted at a fixed position. */
export interface EntityStateEntries {
  status?: MenuEntry | null;
  assign?: MenuEntry | null;
  people?: MenuEntry | null;
  omit?: MenuEntry | null;
  hide?: MenuEntry | null;
}

export interface EntityCardMenuInput {
  t: (key: MessageKey) => string;
  kind: EntityMenuKind;
  /** False means viewer: no settings, no trash, no linking. */
  canManage: boolean;
  /** ShotGrid sheet, present only if the entity is linked to it. */
  sgUrl?: string | null;
  /** Watch (notification tracking); watching only covers shots and assets. */
  watch?: { watching: boolean; onToggle: () => void } | null;
  state?: EntityStateEntries;
  onOpen: () => void;
  onSettings: () => void;
  onTrash: () => void;
  /** Links an asset to shots or sequences: assets only. */
  onLink?: (() => void) | null;
}

export interface EntityCardMenu {
  /** Buttons shown on hover over the card. */
  hoverActions: EntityItemAction[];
  /** `contextEntries` prop of `EntityCard`: what flat actions cannot express. */
  contextEntries: MenuEntry[];
  /** `contextActions` prop: pinning to favourites is inserted just before them. */
  contextActions: EntityItemAction[];
}

/**
 * Label of the watch. Sequences have none: `WatchTargetType` only knows `SHOT`, `ASSET` and
 * `VERSION`, and offering the entry would promise what the API does not keep.
 */
export function watchLabel(
  t: (key: MessageKey) => string,
  kind: EntityMenuKind,
  watching: boolean,
): string | null {
  if (kind === 'shot') return watching ? t('shots.unwatch') : t('shots.watch');
  if (kind === 'asset') return watching ? t('assets.unwatch') : t('assets.watch');
  return null;
}

/** Label of the ShotGrid link, named by entity type like the remote sheets. */
export function shotgridLabel(t: (key: MessageKey) => string, kind: EntityMenuKind): string {
  if (kind === 'shot') return t('shotgrid.openIn.shot');
  if (kind === 'asset') return t('shotgrid.openIn.asset');
  return t('shotgrid.openIn.sequence');
}

export function entityCardMenu(input: EntityCardMenuInput): EntityCardMenu {
  const { t, kind, canManage, sgUrl, watch, state, onLink } = input;

  // The same gestures on hover and on right-click: describing them once prevents them from
  // diverging, as "Delete" and "Move to trash" did on one and the same sequence card.
  const hoverActions: EntityItemAction[] = canManage
    ? [
        { icon: <Settings2 size={14} />, label: t('entity.settings.open'), onClick: input.onSettings },
        ...(onLink ? [{ icon: <Link2 size={15} />, label: t('assets.assign'), onClick: onLink }] : []),
        { icon: <Trash2 size={14} />, label: t('common.moveToTrash'), danger: true, onClick: input.onTrash },
      ]
    : [];

  const contextEntries: MenuEntry[] = [
    { id: 'open', label: t('common.open'), icon: <FolderOpen size={14} />, onSelect: input.onOpen },
    separator('state'),
    ...entriesOf(state?.status, state?.assign, state?.people, state?.omit, state?.hide),
    // Closes the state block: the pinning to favourites, added by `EntityCard`, opens the next one.
    // A surplus separator is removed at render time (`tidyMenu`).
    separator('actions'),
  ];

  const watching = watch?.watching ?? false;
  const followLabel = watch ? watchLabel(t, kind, watching) : null;

  const contextActions: EntityItemAction[] = [
    ...(watch && followLabel
      ? [
          {
            icon: watching ? <BellOff size={14} /> : <Bell size={14} />,
            label: followLabel,
            onClick: watch.onToggle,
          },
        ]
      : []),
    ...(sgUrl
      ? [
          {
            icon: <ExternalLink size={14} />,
            label: shotgridLabel(t, kind),
            onClick: () => window.open(sgUrl, '_blank', 'noreferrer'),
          },
        ]
      : []),
    ...hoverActions.map((action, index) => (index === 0 ? { ...action, separatorBefore: true } : action)),
  ];

  return { hoverActions, contextEntries, contextActions };
}
