// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '../../../types/api';
import type { CompareMode } from '../useCompareState';

/**
 * Composition de l'en-tête de review, décidée hors rendu.
 *
 * Un seul en-tête depuis la fusion : le chrome du viewer porte identité à gauche, actions à
 * droite. Ce qui varie d'un média à l'autre — le sélecteur A/B n'existe que pour les médias
 * plats, le lecteur détachable que pour la vidéo — est décrit ici plutôt que dispersé en
 * conditions dans le JSX, pour être vérifiable pour les quatre types.
 */

/** Actions du coin droit, dans leur ordre d'affichage. */
export type HeaderActionId =
  | 'compare'
  | 'shotgrid'
  | 'live'
  | 'presence'
  | 'publish'
  | 'decision'
  | 'pip'
  | 'theater'
  | 'shortcuts'
  | 'comments';

export interface HeaderActionContext {
  kind: MediaKind;
  /** Média publié : plus de bouton de publication (le verrou de publication est définitif). */
  published: boolean;
  /** Le projet est relié à ShotGrid **et** cette version y a son équivalent. */
  hasSgLink: boolean;
  /** Au moins un autre spectateur sur le média. */
  hasViewers: boolean;
  /** Le lecteur détachable est proposé par la page (vidéo seulement). */
  canPictureInPicture: boolean;
}

/**
 * Actions offertes à droite de l'en-tête fusionné.
 *
 * Le sélecteur A/B n'y figure plus que pour la vidéo, seule à cocher deux ou trois versions
 * d'un coup (grille 2×2). L'image choisit A et B dans la barre d'options du mode
 * « Compare » : un seul endroit visible, au lieu d'un menu d'en-tête et d'un onglet de dock
 * qui se contredisaient. La 3D et le splat montent le leur (`SpatialCompareHeader`), qui
 * arrive par la prop `headerRight` du chrome, juste avant cette liste.
 */
export function headerActions(ctx: HeaderActionContext): HeaderActionId[] {
  return [
    ...(ctx.kind === 'VIDEO' ? (['compare'] as const) : []),
    ...(ctx.hasSgLink ? (['shotgrid'] as const) : []),
    'live',
    ...(ctx.hasViewers ? (['presence'] as const) : []),
    ...(ctx.published ? [] : (['publish'] as const)),
    'decision',
    ...(ctx.kind === 'VIDEO' && ctx.canPictureInPicture ? (['pip'] as const) : []),
    'theater',
    'shortcuts',
    'comments',
  ];
}

/**
 * Surcouche de comparaison image : laquelle des deux vues remplace la visionneuse **dans** le
 * viewport. Le wipe et la différence démontaient auparavant tout le chrome — la bascule de
 * mode et les réglages A/B partaient avec, au moment précis où l'on en avait besoin. Ils sont
 * désormais des surcouches du viewport, comme en vidéo.
 */
export function imageCompareOverlay(compareId: number | null, mode: CompareMode): 'wipe' | 'diff' | null {
  if (compareId == null || mode === 'side') return null;
  return mode;
}

export interface ChromeHostInput {
  /** Le média est chargé : sans lui, aucune branche ne monte de chrome. */
  hasData: boolean;
  kind?: MediaKind;
}

/**
 * Le chrome du viewer héberge-t-il l'en-tête ? Vrai dès qu'une branche en monte un — donc
 * pour les quatre types de média. Seul le chargement n'en monte aucun, et la page rend alors
 * l'en-tête elle-même plutôt que de le laisser disparaître.
 */
export function chromeHostsHeader({ hasData, kind }: ChromeHostInput): boolean {
  return hasData && !!kind;
}
