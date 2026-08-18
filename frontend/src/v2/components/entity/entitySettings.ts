// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Réglages d'une entité de pipe — séquence, plan, asset (C3), partie calculable.
 *
 * Chaque entité avait sa propre boîte d'édition, avec des champs différents sans raison :
 * une séquence n'avait ni description ni vignette, un plan n'avait pas de statut, un asset
 * ne pouvait pas nommer son type. Un seul formulaire les couvre désormais, et ce module
 * décrit ce qu'il contient et ce qu'il envoie.
 *
 * Le PATCH n'emporte **que ce qui a changé** : sur un projet relié à ShotGrid, renvoyer
 * l'intégralité du formulaire republierait vers le site des valeurs que personne n'a
 * touchées, en écrasant au passage ce qui aurait bougé entre-temps.
 */

export type EntityKind = 'sequence' | 'shot' | 'asset';

export interface EntityFormValues {
  name: string;
  code: string;
  /** Libellé de type d'asset, tel que le studio le nomme. */
  typeLabel: string;
  description: string;
  /** Plage de frames d'un plan, saisie en texte (vide = non renseignée). */
  startFrame: string;
  endFrame: string;
  pipelineStatusId: number | null;
  departmentIds: number[];
}

/** Ce que porte réellement l'entité reçue de l'API. */
export interface EntitySource {
  name?: string | null;
  code?: string | null;
  typeLabel?: string | null;
  description?: string | null;
  startFrame?: number | null;
  endFrame?: number | null;
  pipelineStatusId?: number | null;
  departments?: { id: number }[];
}

/** Les champs qu'une entité possède — le formulaire n'affiche que ceux-là. */
export const ENTITY_FIELDS: Record<EntityKind, ReadonlySet<keyof EntityFormValues>> = {
  sequence: new Set(['name', 'code', 'description', 'pipelineStatusId', 'departmentIds']),
  shot: new Set([
    'name',
    'code',
    'description',
    'startFrame',
    'endFrame',
    'pipelineStatusId',
    'departmentIds',
  ]),
  asset: new Set(['name', 'typeLabel', 'description', 'departmentIds']),
};

/** Segment d'URL de l'API pour chaque entité. */
export const ENTITY_SEGMENT: Record<EntityKind, 'sequences' | 'shots' | 'assets'> = {
  sequence: 'sequences',
  shot: 'shots',
  asset: 'assets',
};

export function formFromEntity(source: EntitySource): EntityFormValues {
  return {
    name: source.name ?? '',
    code: source.code ?? '',
    typeLabel: source.typeLabel ?? '',
    description: source.description ?? '',
    startFrame: source.startFrame != null ? String(source.startFrame) : '',
    endFrame: source.endFrame != null ? String(source.endFrame) : '',
    pipelineStatusId: source.pipelineStatusId ?? null,
    departmentIds: (source.departments ?? []).map((d) => d.id),
  };
}

/** Un entier, ou `null` si le champ est vide. Une saisie illisible vaut « vide ». */
function frameValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Ce qu'il faut envoyer : les seuls champs modifiés, et rien pour une entité qui ne les
 * possède pas. Les départements sont exclus — ils passent par leur propre route, qui
 * remplace la liste au lieu de la fusionner.
 */
export function payloadFromForm(
  kind: EntityKind,
  initial: EntityFormValues,
  values: EntityFormValues,
): Record<string, unknown> {
  const fields = ENTITY_FIELDS[kind];
  const payload: Record<string, unknown> = {};
  const changed = (key: keyof EntityFormValues) => fields.has(key) && initial[key] !== values[key];

  if (changed('name')) payload.name = values.name.trim();
  if (changed('code')) payload.code = values.code.trim();
  if (changed('typeLabel')) payload.typeLabel = values.typeLabel.trim() || null;
  if (changed('description')) payload.description = values.description.trim() || null;
  if (changed('startFrame')) payload.startFrame = frameValue(values.startFrame);
  if (changed('endFrame')) payload.endFrame = frameValue(values.endFrame);
  if (changed('pipelineStatusId')) payload.pipelineStatusId = values.pipelineStatusId;
  return payload;
}

/** Les départements ont bougé (ordre indifférent) — inutile d'appeler leur route sinon. */
export function departmentsChanged(initial: EntityFormValues, values: EntityFormValues): boolean {
  if (initial.departmentIds.length !== values.departmentIds.length) return true;
  const before = new Set(initial.departmentIds);
  return values.departmentIds.some((id) => !before.has(id));
}

/**
 * Le nom manquant est la seule saisie qui puisse casser une entité : tout le reste peut
 * être vide. Un code vide passerait la validation du serveur en `min(1)` et reviendrait
 * en erreur brute, autant le dire ici.
 */
export function formError(kind: EntityKind, values: EntityFormValues): 'name' | 'code' | null {
  if (values.name.trim() === '') return 'name';
  if (ENTITY_FIELDS[kind].has('code') && values.code.trim() === '') return 'code';
  return null;
}
