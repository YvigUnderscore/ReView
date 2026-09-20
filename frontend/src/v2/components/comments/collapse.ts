// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Repliage des commentaires trop grands (D6).
 *
 * Un fil se lit ; un mur de texte, non. Au-delà des seuils ci-dessous, un commentaire
 * s'ouvre replié et se déplie au clic — et un fil à cent réponses ne rend que les
 * dernières, les précédentes attendant un geste explicite.
 *
 * Les seuils sont nommés plutôt que dispersés dans le rendu : ce sont des choix de lecture,
 * qu'on doit pouvoir discuter sans relire un composant.
 */

/** Caractères de texte brut au-delà desquels un commentaire s'ouvre replié. */
export const COLLAPSE_CHARS = 600;
/** Lignes au-delà desquelles il s'ouvre replié, même s'il reste court. */
export const COLLAPSE_LINES = 12;
/** Réponses rendues d'emblée dans un fil ; les plus anciennes attendent un clic. */
export const VISIBLE_REPLIES = 10;

/** Texte brut d'un contenu assaini : c'est lui qu'on mesure, pas le balisage. */
export const plainText = (html: string): string => html.replace(/<[^>]*>/g, '');

/** Longueur lisible d'un contenu — la mesure qu'annonce l'indicateur de repliage. */
export const plainLength = (html: string): number => plainText(html).length;

/** Lignes d'un contenu (les sauts de ligne sont préservés à l'affichage). */
export const lineCount = (html: string): number => plainText(html).split('\n').length;

/** Assez grand pour être replié d'office. */
export const isLongText = (html: string): boolean =>
  plainLength(html) > COLLAPSE_CHARS || lineCount(html) > COLLAPSE_LINES;

/** Fil long : les réponses à rendre tout de suite, et celles que le clic révélera. */
export function splitReplies<T>(replies: readonly T[]): { hidden: T[]; shown: T[] } {
  if (replies.length <= VISIBLE_REPLIES) return { hidden: [], shown: [...replies] };
  return {
    hidden: replies.slice(0, replies.length - VISIBLE_REPLIES),
    shown: replies.slice(replies.length - VISIBLE_REPLIES),
  };
}
