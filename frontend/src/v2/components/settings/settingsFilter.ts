// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Le moteur commun à toutes les recherches de réglage.
 *
 * Il vivait dans `pages/admin/settingsSearch`, donc dans l'administration seule : les
 * réglages d'un projet et ceux d'un profil n'avaient aucun moyen de se chercher, alors
 * qu'ils posent exactement la même question — « où règle-t-on ça ». Trois familles
 * d'écrans, une seule façon de chercher.
 */

/** Casse et accents ignorés — « reglages » doit trouver « Réglages ». */
export function fold(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Le texte dans lequel une entrée se cherche : son titre, son aide, et les mots qu'on
 * emploie réellement pour la désigner. Les vides sont écartés — une carte sans aide ne
 * doit pas répondre à une recherche vide de plus que les autres.
 */
export function haystack(parts: readonly (string | undefined)[]): string {
  return fold(parts.filter((part): part is string => Boolean(part)).join(' '));
}

/**
 * L'entrée répond-elle à la recherche ? Une recherche vide laisse tout passer.
 *
 * Tous les mots doivent être présents : « quota stockage » ne doit pas rendre la moitié de
 * l'écran.
 */
export function matchesQuery(hay: string, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return needle.split(/\s+/).every((word) => hay.includes(word));
}
