// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ce que l'appelant a le droit d'écrire sur une version — **calculé côté serveur** et rendu
 * avec le détail du média (`permissions`), pour que l'écran n'ait plus à le deviner.
 *
 * Motif : le front décidait seul d'afficher les gizmos et le bouton « Enregistrer » sur la
 * règle « version non publiée + rôle interne ». Le serveur, lui, exige **l'auteur de la
 * version ou un gestionnaire du projet** (`VersionService.update`) en plus du verrou de
 * publication (`assertWritable(version, 'versionTransform')`). Un ARTIST membre du projet
 * mais non auteur voyait donc un bouton que le serveur refusait ensuite en 403 — un bouton
 * mort, que le projet interdit explicitement.
 *
 * Les deux gardes du service restent en place et gardent leurs messages distincts (403
 * « auteur ou superviseur » d'un côté, `PUBLISHED_LOCKED` de l'autre) : ce prédicat en est la
 * **conjonction**, celle qui décide si le geste est offert. Toute évolution de l'une des deux
 * gardes doit se répercuter ici — c'est le seul endroit qui en répond à l'interface.
 */

/** Ce qu'il faut savoir d'une version pour trancher l'édition de sa transformation. */
export interface VersionTransformSubject {
  authorId: number | null;
  published: boolean;
}

/**
 * La transformation TRS de cette version est-elle éditable par cet appelant ?
 *
 * `manager` est le rôle **effectif sur le projet** (`isProjectManager`), pas le rôle global :
 * un superviseur nommé sur le projet compte, un ADMIN global aussi, un artiste non auteur non.
 */
export function canEditVersionTransform(
  version: VersionTransformSubject,
  userId: number,
  manager: boolean,
): boolean {
  if (version.published) return false;
  return manager || version.authorId === userId;
}
