// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { switcherModesFor, type ModeId, type ReviewMode } from '../chrome/modes';
import { DEFAULT_TOOL, toolsFor, type ReviewTool } from '../chrome/tools';
import type { MessageKey } from '../../../i18n';

/**
 * Bascule de mode et rail du viewer **modèle 3D** — les seuls écarts au chrome spatial commun,
 * rassemblés ici plutôt que dispersés dans `modes.ts`, qui sert aussi au splat.
 *
 * Deux décisions de Phase 50, lot 6, prises sur ce que l'écran offrait réellement :
 *
 *  1. **« Mise en scène » n'est plus un segment.** Le mode n'existait que pour allumer le
 *     layout (vue PiP + caméra-objet + outils caméra + bouton « Publier »), et le panneau
 *     Caméra portait déjà l'interrupteur qui fait la même chose. Deux commandes pour un seul
 *     état, qui se contredisaient dès qu'on changeait de mode. Le mode reste **valide** —
 *     c'est l'interrupteur du panneau Caméra qui l'arme, exactement comme « Annoter » s'arme
 *     depuis l'espace commentaire sans figurer dans la bascule. Rien n'est supprimé.
 *
 *  2. **« Nettoyer » ne s'affiche que s'il sert.** Sur un modèle 3D, ses seuls outils sont les
 *     gizmos TRS — les outils de sélection de nuage sont propres au splat. Ces gizmos écrivent
 *     dans l'un ou l'autre de DEUX endroits, et il suffit que l'un des deux soit atteignable :
 *
 *       - sans sélection, la **transformation de la version** : elle exige
 *         `permissions.editTransform` (auteur de la version ou gestionnaire, avant publication),
 *         calculé par le serveur. Sans ce droit, le mode ne proposait qu'un « Enregistrer »
 *         refusé en 403 ;
 *       - avec des prims sélectionnés dans une scène USD, l'**override de scène** (46.N) : un
 *         delta rejoué pour tous quand un gestionnaire l'enregistre, et joignable à un
 *         commentaire par n'importe quel relecteur. Il ne passe pas par la transformation de
 *         version et n'a donc pas ses droits.
 *
 *     La condition est donc « l'un OU l'autre ». La juger sur le seul droit d'écrire la
 *     transformation aurait retiré le gizmo par prim à tous les non-auteurs — supprimer une
 *     fonctionnalité en supprimant son onglet, exactement ce qu'on cherche à éviter.
 */

/** Ce qui rend le mode « Nettoyer » atteignable sur un modèle 3D. */
export interface Model3DCleanReach {
  /** `permissions.editTransform` du détail média : la transformation de la version. */
  canEditTransform: boolean;
  /** La scène USD a un scenegraph : les gizmos peuvent viser un prim (override de scène). */
  hasScenegraph: boolean;
}

/**
 * Ce que « Nettoyer » fait vraiment sur un modèle : transformer. Clé existante, même message —
 * c'est le libellé que l'historique d'édition donne déjà à ce geste.
 */
const CLEAN_HINT: MessageKey = 'model3d.transformModel';

/** Outils du mode « Nettoyer » qui font réellement quelque chose (hors état de repos). */
export function model3dCleanTools(): ReviewTool[] {
  return toolsFor('clean', 'MODEL_3D').filter((tool) => tool.id !== DEFAULT_TOOL);
}

/**
 * Le mode « Nettoyer » est-il utilisable ? Il faut les deux : au moins un outil au rail, **et**
 * un endroit où garder ce qu'il produit. Un seul des deux donne une impasse — un rail vide, ou
 * un travail qu'on ne peut pas garder.
 */
export function canCleanModel3d({ canEditTransform, hasScenegraph }: Model3DCleanReach): boolean {
  const somewhereToSave = canEditTransform || hasScenegraph;
  return somewhereToSave && model3dCleanTools().length > 0;
}

/**
 * Segments de la bascule pour un modèle 3D, dans l'ordre d'affichage (et des touches 1, 2…).
 *
 * L'infobulle de « Nettoyer » est réécrite au passage : celle du chrome spatial promet
 * « sélection, suppression, volumes de coupe, transformation », quatre gestes dont un seul
 * existe sur un modèle — les trois autres sont les outils de nuage, propres au splat. Un
 * modèle n'y trouve que les gizmos, et c'est ce que l'infobulle dit maintenant.
 */
export function model3dSwitcherModes(canClean: boolean): ReviewMode[] {
  return switcherModesFor('MODEL_3D')
    .filter((mode) => mode.value !== 'stage' && (canClean || mode.value !== 'clean'))
    .map((mode) => (mode.value === 'clean' ? { ...mode, hintKey: CLEAN_HINT } : mode));
}

/**
 * Outils réellement au rail pour un mode donné. « Nettoyer » indisponible rend une liste vide :
 * sans cela, `T`/`R`/`S` continueraient d'y basculer au clavier — le bouton mort reviendrait
 * par la porte de service, le rail en moins.
 */
export function model3dToolsFor(mode: ModeId, canClean: boolean): ReviewTool[] {
  if (mode === 'clean' && !canClean) return [];
  return toolsFor(mode, 'MODEL_3D');
}
