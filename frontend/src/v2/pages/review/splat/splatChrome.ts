// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { switcherModesFor, type ReviewMode } from '../chrome/modes';
import { DEFAULT_TOOL, toolsFor, type ReviewTool } from '../chrome/tools';

/**
 * Bascule de mode et outils d'édition du viewer **splat** — les seuls écarts au chrome spatial
 * commun, rassemblés ici plutôt que dans `chrome/modes.ts`, qui sert aussi au modèle 3D. Jumeau
 * de `three/model3dChrome.ts`, qui fait le même travail pour l'autre viewer spatial.
 *
 * Deux segments quittent la bascule d'en-tête en Phase 50, lot 12 :
 *
 *  1. **« Mise en scène »** — exactement le raisonnement du lot 6 côté 3D. Le mode n'existe que
 *     pour allumer l'atelier caméra (PiP, caméra-objet, outils caméra, bouton « Publier »), et
 *     le panneau Caméra porte déjà l'interrupteur qui fait cela (`SplatPanels`, prop `staging`).
 *     Deux commandes pour un seul état, qui se contredisaient dès qu'on changeait de mode.
 *
 *  2. **« Nettoyer »** — ses outils sont passés **sur le viewer**, dans le popover « Édition »
 *     (`SplatViewerMenus`), au même coin et dans le même langage que les réglages de rendu du
 *     modèle 3D. Le segment redisait depuis l'en-tête un travail qui se fait en regardant le
 *     nuage.
 *
 * Dans les deux cas le mode reste **valide** : rien n'est supprimé, c'est le chemin qui change.
 * L'interrupteur du panneau Caméra arme la mise en scène ; l'interrupteur et les outils du
 * popover arment le nettoyage ; et les lettres du rail (`B`, `L`, `M`, `O`, `T`, `R`, `S`) y
 * mènent comme avant — `toolsFor` reste la seule autorité du rail **comme** du clavier, donc
 * aucun outil retiré d'une surface ne devient armable en douce ni orphelin.
 *
 * Il ne reste qu'« Explorer » : un segment unique ne bascule vers rien, et `canSwitchMode`
 * efface donc la bascule du splat — ce que l'utilisateur demandait, sans perdre une commande.
 */
export function splatSwitcherModes(): ReviewMode[] {
  return switcherModesFor('SPLAT').filter((mode) => mode.value !== 'stage' && mode.value !== 'clean');
}

/**
 * Outils d'édition du nuage, tels que le popover les liste : ceux du mode « Nettoyer », hors
 * état de repos. `nav` reste au rail, où il est l'état de repos de tous les modes ; dans le
 * popover, c'est l'interrupteur qui sort de l'édition, pas un outil.
 */
export function splatEditTools(): ReviewTool[] {
  return toolsFor('clean', 'SPLAT').filter((tool) => tool.id !== DEFAULT_TOOL);
}
