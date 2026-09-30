// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Filtrage des entrées fixes de la palette (destinations et actions).
 *
 * `Command` est monté avec `shouldFilter={false}` — les résultats d'entités viennent du
 * serveur, déjà classés — donc cmdk ne trie rien de lui-même. Sans ce filtre, les entrées
 * fixes restaient toutes affichées pendant la frappe ; avec l'ancien `!hasQuery`, elles
 * disparaissaient toutes. Ni l'un ni l'autre ne laisse taper « kanb » pour aller au kanban.
 *
 * Dans son propre module : un fichier qui exporte à la fois un composant et des fonctions
 * casse le rafraîchissement à chaud de Vite.
 */

/** Comparaison tolérante : casse et accents ignorés — « reglages » doit trouver « Réglages ». */
export function foldForSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Entrées dont le libellé — ou la clé technique, stable d'une langue à l'autre — contient la saisie. */
export function matchDestinations<T extends { label: string; key: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return [...items];
  return items.filter((item) => foldForSearch(item.label).includes(needle) || item.key.includes(needle));
}
