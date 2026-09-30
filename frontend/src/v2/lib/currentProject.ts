// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projet de la page courante — la seule notion qui décide du temps réel et des raccourcis.
 *
 * Deux sources : l'URL quand elle porte le projet (`/projects/:id…`), et le contexte résolu
 * par le fil d'Ariane sur les pages d'entité, dont l'URL ne le porte pas.
 *
 * La liste des familles d'entité est le point sensible. Elle omettait `shots`, `sequences` et
 * `episodes` : sur ces pages le projet courant restait `null`, donc `useSocketInvalidation`
 * n'émettait jamais `join_project` (aucun rafraîchissement temps réel) et `useGlobalShortcuts`
 * ignorait `g k` / `g b`. La barre latérale, elle, continuait d'afficher « Kanban » et
 * « Board » du projet, parce qu'elle consomme le projet **collant** — d'où une incohérence
 * visible : les liens étaient là, les raccourcis équivalents ne faisaient rien.
 *
 * Toute nouvelle page d'entité doit être ajoutée ici, et le test ci-contre la protège.
 */
const ENTITY_PAGE_RE = /^\/(tasks|assets|shots|sequences|episodes|review)\//;

/** Vrai si la page tient son projet du fil d'Ariane plutôt que de son URL. */
export function isEntityPage(pathname: string): boolean {
  return ENTITY_PAGE_RE.test(pathname);
}

/**
 * Projet courant, ou `null` hors de tout projet (accueil, liste des projets, réglages).
 *
 * @param pathname       chemin de la route courante
 * @param routeProjectId identifiant lu dans l'URL `/projects/:id`, sinon `null`
 * @param ctxProjectId   identifiant résolu par le fil d'Ariane, sinon `null`
 */
export function resolveCurrentProjectId(
  pathname: string,
  routeProjectId: number | null,
  ctxProjectId: number | null,
): number | null {
  return routeProjectId ?? (isEntityPage(pathname) ? ctxProjectId : null);
}
