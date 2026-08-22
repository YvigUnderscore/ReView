// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recherche de texte fragmenté.
 *
 * Testing Library compare le texte **propre** à un élément — les nœuds texte qui sont ses
 * enfants directs, mis bout à bout. Deux phrases séparées par un `<br/>` dans un même
 * paragraphe forment donc une seule chaîne, et `getByText('Première phrase.')` échoue sur
 * un écran pourtant correct. `textIncluding` cible le fragment sans remonter aux ancêtres
 * (eux n'ont pas de nœud texte direct qui le contienne), là où `{ exact: false }`
 * remonterait tout l'arbre et renverrait plusieurs correspondances.
 */
export const textIncluding =
  (fragment: string) =>
  (text: string): boolean =>
    text.includes(fragment);
