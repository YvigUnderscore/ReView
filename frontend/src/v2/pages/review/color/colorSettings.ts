// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Viewer color management — **the project's**, and nothing else: the display/view pair defined in
 * the project settings (`ProjectColorSection`) decides the display transform applied to the image.
 * Nothing is sent back to the server, nothing is written to the file: it is a display transform,
 * never a modification of the media.
 *
 * Ad hoc adjustment (display/view chosen in the dock, exposure, gamma, before/after toggle)
 * disappeared in Phase 50 with the Color panel — a product decision. This module therefore only
 * keeps what is still used: the studio pipeline, and its resolution against the list of displays
 * the config actually exposes.
 *
 * **Pure** module: reading the displays and the LUT lives in `colorQueries.ts`, rendering in
 * `renderTransform.ts`.
 */

/** Color configuration inherited from the project, as served by `GET /api/media/:id`. */
export interface ProjectColor {
  configId?: string;
  display?: string;
  view?: string;
}

export interface ResolvedDisplayView {
  configId: string;
  display: string;
  view: string;
}

/**
 * Display/view pair actually requested from the server — the project's, if it exists **in the
 * loaded config**. A replaced config leaves the projects that cited it with a dead pair: a LUT that
 * no longer makes sense here must not be baked.
 */
export function resolveDisplayView(
  project: ProjectColor | null | undefined,
  displays: { name: string; views: string[] }[] = [],
): ResolvedDisplayView | null {
  const configId = project?.configId;
  if (!configId) return null;
  const { display, view } = project;
  if (!display || !view) return null;
  // While the list is not loaded we trust the project; once loaded, a
  // pair absent from the config (replaced config) is no longer valid.
  if (displays.length > 0 && !displays.some((d) => d.name === display && d.views.includes(view))) return null;
  return { configId, display, view };
}
