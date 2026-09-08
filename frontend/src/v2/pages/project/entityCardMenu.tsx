// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Bell, BellOff, ExternalLink, FolderOpen, Link2, Settings2, Trash2 } from 'lucide-react';
import { entriesOf, separator, type EntityItemAction, type MenuEntry } from '../../lib/menuSpec';
import type { MessageKey } from '../../i18n';

/**
 * Menu unique des cartes d'entité d'un projet — séquences, plans, assets.
 *
 * Deux systèmes coexistaient : des tables d'actions par onglet (`shotCardActions`,
 * `assetCardActions`) et, à côté, les entrées produites par les hooks de menu. Chaque
 * onglet en composait sa version, d'où trois vocabulaires pour trois gestes identiques —
 * « Modifier » ici et « Réglages » là, « Supprimer » ici et « Mettre à la corbeille » là,
 * l'épinglage en cinquième position sur un écran et en dernière sur un autre. Le clic
 * droit étant la voie principale du produit, cette dérive fait douter de ce qu'on
 * déclenche.
 *
 * Tout se décrit désormais ici, comme une donnée : l'ordre est le même quel que soit le
 * type d'entité, et une entrée absente (le suivi sur une séquence, l'omission hors d'un
 * plan) ne décale pas les autres. Quatre blocs :
 *
 * 1. **ouvrir** — la destination de la carte ;
 * 2. **état de l'entité** — statut, assignation, personnes, omission, visibilité, telles
 *    que les hooks les produisent ;
 * 3. **suivi personnel et lien externe** — l'épinglage aux favoris s'insère en tête de ce
 *    bloc, `EntityCard` le posant lui-même à partir de sa prop `favorite` ;
 * 4. **gestion** — réglages, rattachement, corbeille, en dernier parce que destructeur.
 *
 * Le vocabulaire suit ce que l'action fait réellement : `DELETE /api/{shots,assets,
 * sequences}/:id` est un `softDelete` — l'entité part à la corbeille et se restaure —
 * donc « Mettre à la corbeille », jamais « Supprimer » ; le crayon ouvre le panneau de
 * réglages, donc « Réglages », jamais « Modifier ».
 */

export type EntityMenuKind = 'sequence' | 'shot' | 'asset';

/** Entrées produites par les hooks de menu, insérées à place fixe. */
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
  /** Faux = spectateur : ni réglages, ni corbeille, ni rattachement. */
  canManage: boolean;
  /** Fiche ShotGrid, présente seulement si l'entité y est reliée. */
  sgUrl?: string | null;
  /** Suivi de notifications ; le suivi ne connaît que les plans et les assets. */
  watch?: { watching: boolean; onToggle: () => void } | null;
  state?: EntityStateEntries;
  onOpen: () => void;
  onSettings: () => void;
  onTrash: () => void;
  /** Rattacher un asset à des plans ou des séquences — assets seulement. */
  onLink?: (() => void) | null;
}

export interface EntityCardMenu {
  /** Boutons au survol de la carte. */
  hoverActions: EntityItemAction[];
  /** Prop `contextEntries` d'`EntityCard` — ce que les actions plates ne savent pas dire. */
  contextEntries: MenuEntry[];
  /** Prop `contextActions` — l'épinglage aux favoris s'insère juste avant elles. */
  contextActions: EntityItemAction[];
}

/**
 * Libellé du suivi. Les séquences n'en ont pas : `WatchTargetType` ne connaît que
 * `SHOT`, `ASSET` et `VERSION` — proposer l'entrée promettrait ce que l'API ne tient pas.
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

/** Libellé du lien ShotGrid, nommé par type d'entité comme les fiches distantes. */
export function shotgridLabel(t: (key: MessageKey) => string, kind: EntityMenuKind): string {
  if (kind === 'shot') return t('shotgrid.openIn.shot');
  if (kind === 'asset') return t('shotgrid.openIn.asset');
  return t('shotgrid.openIn.sequence');
}

export function entityCardMenu(input: EntityCardMenuInput): EntityCardMenu {
  const { t, kind, canManage, sgUrl, watch, state, onLink } = input;

  // Les mêmes gestes au survol et au clic droit : les décrire une fois interdit qu'ils
  // se mettent à diverger, comme l'avaient fait « Supprimer » et « Mettre à la corbeille »
  // sur une seule et même carte de séquence.
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
    // Ferme le bloc d'état : l'épinglage aux favoris, ajouté par `EntityCard`, ouvre le
    // suivant. Un séparateur en trop est retiré au rendu (`tidyMenu`).
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
