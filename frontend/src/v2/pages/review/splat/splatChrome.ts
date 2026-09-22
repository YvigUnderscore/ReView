// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../../i18n';
import { switcherModesFor, type ModeId, type ReviewMode } from '../chrome/modes';
import { DEFAULT_TOOL, toolsFor, type RailSection, type ReviewTool } from '../chrome/tools';

/**
 * Bascule de mode et rail du viewer **splat** — les seuls écarts au chrome spatial commun,
 * rassemblés ici plutôt que dans `chrome/modes.ts`, qui sert aussi au modèle 3D. Jumeau
 * de `three/model3dChrome.ts`, qui fait le même travail pour l'autre viewer spatial.
 *
 * Deux segments quittent la bascule d'en-tête en Phase 50, lot 12 :
 *
 *  1. **« Mise en scène »** — exactement le raisonnement du lot 6 côté 3D. Le mode n'existe que
 *     pour allumer l'atelier caméra (PiP, caméra-objet, outils caméra, bouton « Publier »), et
 *     le panneau Caméra porte déjà l'interrupteur qui fait cela (`SplatPanels`, prop `staging`).
 *     Deux commandes pour un seul état, qui se contredisaient dès qu'on changeait de mode.
 *
 *  2. **« Nettoyer »** — le segment redisait depuis l'en-tête un travail qui se fait en regardant
 *     le nuage.
 *
 * Le lot 12 avait déplacé ses outils **dans un popover du viewer**, et c'est allé trop loin : la
 * demande était de retirer le segment, pas de ranger les outils derrière un clic. Le lot 13 les
 * ramène donc au RAIL, dans un second groupe permanent (`splatEditRail`) : sélectionner,
 * supprimer, déplacer, mettre à l'échelle sont à nouveau à un clic, sans mode à armer dans
 * l'en-tête. Le popover « Édition » a disparu avec son doublon ; celui de rendu reste.
 *
 * Dans les deux cas le mode reste **valide** : rien n'est supprimé, c'est le chemin qui change.
 * L'interrupteur du panneau Caméra arme la mise en scène ; le second groupe du rail arme le
 * nettoyage ; et les lettres (`B`, `L`, `M`, `O`, `T`, `R`, `S`) y mènent comme avant —
 * `toolsFor` reste la seule autorité du rail **comme** du clavier, donc aucun outil retiré d'une
 * surface ne devient armable en douce ni orphelin.
 *
 * Il ne reste qu'« Explorer » : un segment unique ne bascule vers rien, et `canSwitchMode`
 * efface donc la bascule du splat — ce que l'utilisateur demandait, sans perdre une commande.
 */
export function splatSwitcherModes(): ReviewMode[] {
  return switcherModesFor('SPLAT').filter((mode) => mode.value !== 'stage' && mode.value !== 'clean');
}

/** Titre du second groupe du rail — le même mot que portait le popover qu'il remplace. */
const EDIT_TITLE: MessageKey = 'viewer.edit.title';

/**
 * Outils d'édition du nuage, tels que le rail les liste : ceux du mode « Nettoyer », hors état
 * de repos. `nav` reste au premier groupe, où il est l'état de repos de tous les modes ; c'est
 * d'ailleurs par lui qu'on ressort de l'édition.
 */
export function splatEditTools(): ReviewTool[] {
  return toolsFor('clean', 'SPLAT').filter((tool) => tool.id !== DEFAULT_TOOL);
}

/**
 * Second groupe du rail — présent seulement quand l'éditeur est monté (`showEdit` : média
 * éditable, droits, viewer prêt). Sans lui, ces outils n'écrivent nulle part : les montrer
 * reviendrait à proposer de supprimer des splats à qui ne le peut pas.
 */
export function splatEditRail(showEdit: boolean): RailSection | undefined {
  if (!showEdit) return undefined;
  return { mode: 'clean', titleKey: EDIT_TITLE, tools: splatEditTools() };
}

/**
 * Outils réellement au rail et au clavier pour un mode donné. L'éditeur absent rend une liste
 * vide pour « Nettoyer » : sans cela, `B`/`L`/`M`/`O`/`T`/`R`/`S` continueraient d'y basculer au
 * clavier alors que le groupe du rail, lui, a disparu — l'outil sans implémentation reviendrait
 * par la porte de service. Même règle que `model3dToolsFor` côté modèle.
 */
export function splatToolsFor(mode: ModeId, showEdit: boolean): ReviewTool[] {
  if (mode === 'clean' && !showEdit) return [];
  return toolsFor(mode, 'SPLAT');
}
