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
 * Le sélecteur A/B n'y figure que pour la vidéo et l'image : la 3D et le splat montent le
 * leur (`SpatialCompareHeader`), alimenté par leur propre hook de comparaison — il arrive
 * par la prop `headerRight` du chrome, juste avant cette liste.
 */
export function headerActions(ctx: HeaderActionContext): HeaderActionId[] {
  const flat = ctx.kind === 'VIDEO' || ctx.kind === 'IMAGE';
  return [
    ...(flat ? (['compare'] as const) : []),
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
 * Superposition de comparaison image : le wipe et la différence **remplacent** la visionneuse
 * — et donc le chrome qui la porte. Un seul endroit décide, pour que la branche image et la
 * page ne divergent pas sur qui rend l'en-tête.
 */
export function imageCompareOverlay(compareId: number | null, mode: CompareMode): 'wipe' | 'diff' | null {
  if (compareId == null || mode === 'side') return null;
  return mode;
}

export interface ChromeHostInput {
  /** Le média est chargé : sans lui, aucune branche ne monte de chrome. */
  hasData: boolean;
  kind?: MediaKind;
  compareId: number | null;
  compareMode: CompareMode;
}

/**
 * Le chrome du viewer héberge-t-il l'en-tête ? Vrai dès qu'une branche en monte un. Deux
 * états n'en montent aucun — le chargement et la superposition de comparaison image — et la
 * page rend alors l'en-tête elle-même, plutôt que de le laisser disparaître.
 */
export function chromeHostsHeader({ hasData, kind, compareId, compareMode }: ChromeHostInput): boolean {
  if (!hasData || !kind) return false;
  if (kind === 'IMAGE') return imageCompareOverlay(compareId, compareMode) === null;
  return true;
}
