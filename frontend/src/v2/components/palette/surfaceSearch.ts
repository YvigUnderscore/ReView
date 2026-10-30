// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { adminGroupLabel, adminSections } from '../../pages/admin/adminSections';
import { fold, sectionHaystack, sectionMatches } from '../../pages/admin/settingsSearch';
import { sectionLabel, type DocsSection } from '../../pages/docs/docsManifest';
import { searchDocs } from '../../pages/docs/docsSearch';
import type { Tr } from '../../i18n';
import type { Role } from '../../types/api';

/**
 * The two families of results that are not baseline rows: the **documentation** and the **settings**.
 *
 * The thirteen other families come from `GET /api/search`: they are data, filtered by the server. These are **screens**:
 * what one searches for by typing "watermark" is not a record, it is the place where it is set. They are therefore computed
 * here, for three reasons that hold together:
 *
 *  - the settings index **already exists** on the client (`admin/settingsSearch`, written for the internal search of the
 *    Settings tab); writing a second one on the server would give two tables that diverge at the first section rename;
 *  - section labels are translated into the reader's language, which the server does not know;
 *  - the `DOCUMENTATION/` corpus is not in the backend image (its build context is `backend/`): the only existing index is
 *    the manifest served by the frontend.
 *
 * **Segregation.** The same requirement as for the server families: the access filter is applied at the source, not on the
 * results produced. `/admin/*` is refused to every role other than ADMIN (`AdminPage` renders "restricted access"): offering
 * these screens to an artist would promise them a closed door. `/docs`, on the other hand, is open to all logged-in roles
 * (sidebar link without condition), and the documentation is public within the product: it carries no segregation to bear.
 */

/** A destination offered by the palette: a screen, not a record. */
export interface SurfaceHit {
  /** Stable identifier for cmdk (`value`) and for the render key. */
  id: string;
  label: string;
  /** Secondary line: where this result comes from, or why it matches. */
  hint: string;
  to: string;
}

/**
 * Number of results per family. Same scale as the reference data on the server (`EXTRA_LIMITS`): these are unique
 * screens, not lists that follow production, and the palette must stay readable at a glance.
 */
export const SURFACE_LIMITS = { docs: 4, settings: 5 } as const;

/**
 * Documentation pages answering the input, by their title **and by their content**, the chapter titles of the manifest
 * serving as a table of contents.
 *
 * The ranking itself is no longer here: it lives in `pages/docs/docsSearch`, the engine that the `/docs` table of contents
 * also uses. While it lived in the palette, searching "watermark" opened the right page from Ctrl+K but rendered nothing from
 * the documentation page. Here one only limits the list and dresses it.
 */
export function searchDocSurfaces(sections: DocsSection[], query: string, t: Tr): SurfaceHit[] {
  return searchDocs(sections, query)
    .slice(0, SURFACE_LIMITS.docs)
    .map(({ section, page, heading }) => ({
      id: `doc-${page.path}`,
      label: page.title,
      hint: [sectionLabel(section, t), heading ?? page.summary].filter(Boolean).join(' · '),
      to: `/docs?p=${encodeURIComponent(page.path)}`,
    }));
}

/**
 * Settings screens answering the input.
 *
 * The index is that of the internal search of the Settings tab: section labels, their usage keywords ("filigrane" as much as
 * "watermark") and the field labels of the catch-all section. Nothing is copied here.
 *
 * The role is read **before** the list is built: an artist does not get a filtered list, they get nothing, since the screen
 * would be refused to them.
 */
export function searchSettingsSurfaces(query: string, role: Role | undefined, t: Tr): SurfaceHit[] {
  if (role !== 'ADMIN') return [];
  const needle = query.trim();
  if (!needle) return [];

  return (
    adminSections(t)
      .filter((section) => sectionMatches(sectionHaystack(section.key, section.label, t), needle))
      // The screen's label takes precedence over its keywords: "corbeille" must render the Corbeille before the catch-all
      // section, which carries the word in its list of synonyms. Stable sort: on a tie, the sidebar order decides.
      .map((section) => ({ section, score: fold(section.label).includes(fold(needle)) ? 2 : 1 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SURFACE_LIMITS.settings)
      .map(({ section }) => ({
        id: `setting-${section.key}`,
        label: section.label,
        hint: adminGroupLabel(t, section.group),
        to: `/admin/${section.key}`,
      }))
  );
}
