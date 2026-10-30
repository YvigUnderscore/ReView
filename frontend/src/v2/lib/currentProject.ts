// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Project of the current page — the only notion that decides real-time updates and shortcuts.
 *
 * Two sources: the URL when it carries the project (`/projects/:id…`), and the context resolved
 * by the breadcrumb on entity pages, whose URL does not carry it.
 *
 * The list of entity families is the sensitive point. It omitted `shots`, `sequences` and
 * `episodes`: on those pages the current project stayed `null`, so `useSocketInvalidation` never
 * emitted `join_project` (no real-time refresh) and `useGlobalShortcuts` ignored `g k` / `g b`.
 * The sidebar, for its part, kept showing "Kanban" and "Board" for the project, because it consumes
 * the **sticky** project — hence a visible inconsistency: the links were there, the equivalent
 * shortcuts did nothing.
 *
 * Any new entity page must be added here, and the test next to it protects it.
 */
const ENTITY_PAGE_RE = /^\/(tasks|assets|shots|sequences|episodes|review)\//;

/** True if the page takes its project from the breadcrumb rather than its URL. */
export function isEntityPage(pathname: string): boolean {
  return ENTITY_PAGE_RE.test(pathname);
}

/**
 * Current project, or `null` outside any project (home, project list, settings).
 *
 * @param pathname       path of the current route
 * @param routeProjectId identifier read from the `/projects/:id` URL, otherwise `null`
 * @param ctxProjectId   identifier resolved by the breadcrumb, otherwise `null`
 */
export function resolveCurrentProjectId(
  pathname: string,
  routeProjectId: number | null,
  ctxProjectId: number | null,
): number | null {
  return routeProjectId ?? (isEntityPage(pathname) ? ctxProjectId : null);
}
