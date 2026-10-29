// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Readable URL slugs (slug + id). Routes stay resolved by the **id**
 * (numeric suffix): the slug is only cosmetic and old pure-id links
 * (`/review/219`) keep working. No migration: the slug is derived from the
 * name already present (project, media file…) — never stored.
 *
 * Examples: `/projects/le-projet-demo-390`, `/review/perso-principal-v01-219`.
 */

// Range of combining diacritics (U+0300–U+036F), removed after NFD normalisation.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Normalises a text into a URL segment: no accents, lowercase, words separated by dashes. */
export function slugify(input: string | null | undefined): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, ''); // no trailing dash after truncation
}

/** `slugified-name-{id}` (or just `{id}` if the name produces no slug). */
export function entitySlug(name: string | null | undefined, id: number): string {
  const s = slugify(name);
  return s ? `${s}-${id}` : String(id);
}

/** Slug of a media file from its file name (extension removed). */
export function mediaSlug(originalName: string | null | undefined, id: number): string {
  const base = (originalName ?? '').replace(/\.[a-z0-9]{1,8}$/i, '');
  return entitySlug(base, id);
}

/**
 * Extracts the numeric id from a slugged route parameter. The id is always the last group of digits
 * (it is appended as a suffix after a dash). Tolerates the pure id.
 * Returns `NaN` if there are no digits — the callers already handle an invalid id.
 */
export function parseIdParam(param: string | null | undefined): number {
  if (!param) return NaN;
  const m = String(param).match(/(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

/** Client path of a project (`/projects/{slug}`), with an optional suffix (`/kanban`…). */
export function projectPath(project: { id: number; name?: string | null }, suffix = ''): string {
  return `/projects/${entitySlug(project.name, project.id)}${suffix}`;
}

/**
 * Client path of an episode (`/episodes/{slug}`).
 *
 * The Episode level is optional per project: this path only leads somewhere on a project where it is
 * enabled — elsewhere, no screen builds it.
 */
export function episodePath(episode: { id: number; code?: string | null }): string {
  return `/episodes/${entitySlug(episode.code, episode.id)}`;
}

/** Client path of a media review (`/review/{slug}`). */
export function reviewPath(media: { id: number; originalName?: string | null }): string {
  return `/review/${mediaSlug(media.originalName, media.id)}`;
}
