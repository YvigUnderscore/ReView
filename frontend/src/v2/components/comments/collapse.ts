// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Repliage des commentaires trop grands (D6).
 *
 * Un fil se lit ; un mur de texte, non. Un commentaire qui ne tient pas dans sa surface
 * s'ouvre donc replié et se déplie au clic — et un fil à cent réponses ne rend que les
 * dernières, les précédentes attendant un geste explicite.
 *
 * « Ne tient pas » se MESURE, ça ne s'estime pas. Un plafond de caractères donnait la même
 * réponse à une carte ancrée de 15 rem et au fil de commentaires, bien plus large : le bouton
 * « dérouler » y apparaissait dès 67 caractères alors qu'il en fallait plus de 120 pour
 * dépasser trois lignes, et le clic ne révélait rien. Le débordement réel de l'élément replié,
 * lui, vaut pour toutes les largeurs et toutes les tailles de police à la fois.
 */

/** Réponses rendues d'emblée dans un fil ; les plus anciennes attendent un clic. */
export const VISIBLE_REPLIES = 10;

/** Texte brut d'un contenu assaini : c'est lui qu'on compte, pas le balisage. */
const plainText = (html: string): string => html.replace(/<[^>]*>/g, '');

/** Longueur lisible d'un contenu — la mesure qu'annonce l'indicateur de repliage. */
export const plainLength = (html: string): number => plainText(html).length;

/**
 * Tolérance de mesure, en pixels. Une bordure arrondie ou un demi-pixel de hauteur de ligne
 * ne cachent aucun texte : en dessous, le repliage ne masque rien et l'indicateur n'aurait
 * rien à annoncer.
 */
export const CLIP_SLACK = 1;

/**
 * L'élément replié cache-t-il du texte ? `scrollHeight` porte la hauteur du contenu entier,
 * `clientHeight` celle qu'on en laisse voir : leur écart est exactement ce que le repliage
 * masque. Rien à deviner, donc, ni sur la largeur de la surface ni sur la police.
 */
export const isClipped = (box: { scrollHeight: number; clientHeight: number } | null): boolean =>
  !!box && box.scrollHeight - box.clientHeight > CLIP_SLACK;

/** Fil long : les réponses à rendre tout de suite, et celles que le clic révélera. */
export function splitReplies<T>(replies: readonly T[]): { hidden: T[]; shown: T[] } {
  if (replies.length <= VISIBLE_REPLIES) return { hidden: [], shown: [...replies] };
  return {
    hidden: replies.slice(0, replies.length - VISIBLE_REPLIES),
    shown: replies.slice(replies.length - VISIBLE_REPLIES),
  };
}
