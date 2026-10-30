// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { qk } from './query';
import type { Tr } from '../i18n';
import type { ProjectSettings } from '../types/api';

/**
 * Project settings: studio inheritance vs local override.
 *
 * The screen handles the EFFECTIVE settings (studio + project overrides). Re-saving everything in bulk
 * froze into the project everything it was only inheriting: resolution, cadence, naming, burn-ins,
 * lighting and the studio's OCIO stopped coming down to it, without anything signalling it.
 *
 * We therefore only send what the person actually touched — a PATCH of sections, computed here,
 * without state or request.
 */

/** Sections of a project override — mirror of `SETTINGS_SECTIONS` on the backend. */
export const SETTINGS_SECTIONS = [
  'resolution',
  'framerate',
  'nomenclature',
  'departments',
  'naming',
  'reviewRequest',
  'defaultLighting',
  'color',
  'burnin',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** What a project actually overrides (the rest comes from the studio). */
export type ProjectSettingsOverride = Partial<Pick<ProjectSettings, SettingsSection>>;

/** PATCH body: absent section = unchanged, `null` section = back to inheritance. */
export type ProjectSettingsPatch = { [K in SettingsSection]?: ProjectSettings[K] | null };

/** GET /api/projects/:id/settings/override — the inheritance editing view. */
export interface ProjectSettingsOverrideView {
  override: ProjectSettingsOverride;
  studio: ProjectSettings;
  overrides: SettingsSection[];
}

/** Cache key of the override view — under `qk.projectSettings` so it is invalidated with it. */
export const overrideKey = (projectId: number) => [...qk.projectSettings(projectId), 'override'] as const;

/**
 * Structural equality, independent of key order: a draft rebuilt by spreading
 * (`{ ...d.resolution, width }`) must not be taken for a modified one.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // A key set to `undefined` is equivalent to an absent key: that is how JSON comes back.
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const key of keys) if (!sameValue(ao[key], bo[key])) return false;
  return true;
}

/** Sections the draft changes compared to its starting point. */
export function changedSections(baseline: ProjectSettings, draft: ProjectSettings): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => !sameValue(baseline[section], draft[section]));
}

/**
 * PATCH to send: only the touched sections. An emptied section (`undefined`) reverts to inheritance,
 * which the backend expects in the form `null`.
 */
export function buildSettingsPatch(baseline: ProjectSettings, draft: ProjectSettings): ProjectSettingsPatch {
  const patch: ProjectSettingsPatch = {};
  for (const section of changedSections(baseline, draft)) {
    // Each section keeps its own type; the write goes through an indexed view.
    (patch as Record<string, unknown>)[section] = draft[section] ?? null;
  }
  return patch;
}

/** PATCH that hands every section of a row of the panel back to the studio. */
export function revertPatch(sections: SettingsSection[]): ProjectSettingsPatch {
  const patch: ProjectSettingsPatch = {};
  for (const section of sections) (patch as Record<string, unknown>)[section] = null;
  return patch;
}

/** A row of the inheritance panel: a label, the sections it covers, the studio value. */
export interface InheritanceRow {
  id: string;
  label: string;
  /** The override sections this row represents (the format covers two). */
  sections: SettingsSection[];
  /** Summary of what the studio imposes — what a revert brings back to. */
  studioValue?: string;
}

/**
 * Rows of the inheritance panel. A function rather than a module constant: a table of labels frozen
 * at import would keep the language of the load.
 */
export function inheritanceRows(t: Tr, studio: ProjectSettings | undefined): InheritanceRow[] {
  const nomenclature = studio?.nomenclature;
  return [
    {
      id: 'format',
      label: t('pipeline.formatRate'),
      sections: ['resolution', 'framerate'],
      studioValue: studio
        ? `${studio.resolution.width}×${studio.resolution.height} · ${studio.framerate}`
        : undefined,
    },
    {
      id: 'numbering',
      label: t('inheritance.section.numbering'),
      sections: ['nomenclature'],
      studioValue: nomenclature
        ? `${nomenclature.sequencePrefix} / ${nomenclature.shotPrefix} · ${nomenclature.padding} · ${nomenclature.step}`
        : undefined,
    },
    { id: 'departments', label: t('pipeline.departments'), sections: ['departments'] },
    { id: 'fileNaming', label: t('inheritance.section.fileNaming'), sections: ['naming'] },
    {
      id: 'reviewRequest',
      label: t('reviewRequest.title'),
      sections: ['reviewRequest'],
      // What the studio imposes, in one line: a revert brings back "that" by rendering the section.
      studioValue: studio
        ? studio.reviewRequest.requireNote
          ? t('reviewRequest.summary.required', { min: studio.reviewRequest.minNoteLength })
          : t('reviewRequest.summary.optional')
        : undefined,
    },
    { id: 'lighting', label: t('lighting.default.title'), sections: ['defaultLighting'] },
    { id: 'color', label: t('color.title'), sections: ['color'] },
    { id: 'burnin', label: t('burnin.title'), sections: ['burnin'] },
  ];
}
