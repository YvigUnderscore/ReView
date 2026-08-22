// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { qk } from './query';
import type { Tr } from '../i18n';
import type { ProjectSettings } from '../types/api';

/**
 * Réglages projet : héritage studio vs surcharge locale.
 *
 * L'écran manipule les réglages EFFECTIFS (studio + surcharges du projet). Les
 * réenregistrer en bloc figeait dans le projet tout ce qu'il ne faisait qu'hériter : la
 * résolution, la cadence, la nomenclature, les burn-ins, l'éclairage et l'OCIO du studio
 * cessaient d'y descendre, sans que rien ne le signale.
 *
 * On n'envoie donc que ce que la personne a réellement touché — un PATCH de sections,
 * calculé ici, sans état ni requête.
 */

/** Sections d'un override projet — miroir de `SETTINGS_SECTIONS` côté backend. */
export const SETTINGS_SECTIONS = [
  'resolution',
  'framerate',
  'nomenclature',
  'departments',
  'naming',
  'defaultLighting',
  'color',
  'burnin',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Ce qu'un projet surcharge réellement (le reste vient du studio). */
export type ProjectSettingsOverride = Partial<Pick<ProjectSettings, SettingsSection>>;

/** Corps du PATCH : section absente = inchangée, section `null` = retour à l'héritage. */
export type ProjectSettingsPatch = { [K in SettingsSection]?: ProjectSettings[K] | null };

/** GET /api/projects/:id/settings/override — la vue d'édition de l'héritage. */
export interface ProjectSettingsOverrideView {
  override: ProjectSettingsOverride;
  studio: ProjectSettings;
  overrides: SettingsSection[];
}

/** Clé de cache de la vue d'override — sous `qk.projectSettings` pour être invalidée avec. */
export const overrideKey = (projectId: number) => [...qk.projectSettings(projectId), 'override'] as const;

/**
 * Égalité structurelle, indépendante de l'ordre des clés : un brouillon reconstruit par
 * étalement (`{ ...d.resolution, width }`) ne doit pas passer pour modifié.
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
  // Une clé à `undefined` équivaut à une clé absente : c'est ainsi que le JSON revient.
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const key of keys) if (!sameValue(ao[key], bo[key])) return false;
  return true;
}

/** Sections que le brouillon modifie par rapport à son point de départ. */
export function changedSections(baseline: ProjectSettings, draft: ProjectSettings): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => !sameValue(baseline[section], draft[section]));
}

/**
 * PATCH à envoyer : les seules sections touchées. Une section vidée (`undefined`) revient
 * à l'héritage, ce que le backend attend sous la forme `null`.
 */
export function buildSettingsPatch(baseline: ProjectSettings, draft: ProjectSettings): ProjectSettingsPatch {
  const patch: ProjectSettingsPatch = {};
  for (const section of changedSections(baseline, draft)) {
    // Chaque section garde son propre type ; l'écriture passe par une vue indexée.
    (patch as Record<string, unknown>)[section] = draft[section] ?? null;
  }
  return patch;
}

/** PATCH qui rend au studio toutes les sections d'une ligne du panneau. */
export function revertPatch(sections: SettingsSection[]): ProjectSettingsPatch {
  const patch: ProjectSettingsPatch = {};
  for (const section of sections) (patch as Record<string, unknown>)[section] = null;
  return patch;
}

/** Une ligne du panneau d'héritage : un libellé, les sections qu'elle couvre, la valeur studio. */
export interface InheritanceRow {
  id: string;
  label: string;
  /** Les sections d'override que cette ligne représente (le format en couvre deux). */
  sections: SettingsSection[];
  /** Résumé de ce que le studio impose — ce vers quoi un retour ramène. */
  studioValue?: string;
}

/**
 * Lignes du panneau d'héritage. Fonction et non constante de module : une table de
 * libellés figée à l'import garderait la langue du chargement.
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
    { id: 'lighting', label: t('lighting.default.title'), sections: ['defaultLighting'] },
    { id: 'color', label: t('color.title'), sections: ['color'] },
    { id: 'burnin', label: t('burnin.title'), sections: ['burnin'] },
  ];
}
