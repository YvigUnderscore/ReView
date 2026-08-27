// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ce qu'une vignette écrit quand elle n'a pas d'image — le nom de l'élément, mis à la
 * taille de la place disponible. Séparé de `EntityThumb` parce qu'un fichier de composant
 * n'exporte que des composants (rafraîchissement à chaud).
 */

/** Taille de police décroissante avec la longueur : un nom long doit rester lisible. */
export function thumbScale(label: string): string {
  if (label.length <= 8) return 'text-xl';
  if (label.length <= 16) return 'text-base';
  if (label.length <= 32) return 'text-sm';
  return 'text-xs';
}

/**
 * Abrégé des vignettes trop petites pour un nom (ligne compacte : 32 px de côté).
 *
 * En production les noms partagent leur préfixe et se distinguent par leur numéro
 * (`SH0120`, `SH0130`) : c'est donc le dernier nombre qui identifie, pas les initiales —
 * « SH » les rendrait toutes identiques. À défaut de chiffre, les initiales des deux
 * premiers mots, comme une pastille d'avatar.
 */
export function thumbAbbrev(name: string): string {
  const clean = name.trim();
  if (!clean) return '';
  const numbers = clean.match(/\d+/g);
  // Quatre chiffres au plus : au-delà, rien ne serait lisible dans 32 px.
  if (numbers) return numbers[numbers.length - 1].slice(-4);
  // Découpage sur les séparateurs de nomenclature (`_`, `-`, `.`) autant que sur l'espace.
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  // Itération par caractères (et non par unités de code) : un nom peut commencer par un
  // caractère hors plan de base, qu'un `slice` couperait en deux moitiés illisibles.
  const letters = words.length >= 2 ? [...words[0]][0] + [...words[1]][0] : [...clean].slice(0, 2).join('');
  return letters.toUpperCase();
}
