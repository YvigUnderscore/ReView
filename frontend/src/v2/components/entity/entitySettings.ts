// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings of a pipe entity (sequence, shot, asset) (C3), the computable part.
 *
 * Each entity used to have its own edit box, with different fields for no reason: a sequence had neither a
 * description nor a thumbnail, a shot had no status, and an asset could not name its type. A single form now covers
 * them all, and this module describes what it contains and what it sends.
 *
 * The PATCH carries **only what changed**: on a project linked to ShotGrid, sending the whole form back would
 * republish to the site values nobody touched, overwriting in passing what had moved in the meantime.
 */

export type EntityKind = 'sequence' | 'shot' | 'asset';

export interface EntityFormValues {
  name: string;
  code: string;
  /** Asset type label, as the studio names it. */
  typeLabel: string;
  description: string;
  /** Frame range of a shot, entered as text (empty = not filled in). */
  startFrame: string;
  endFrame: string;
  pipelineStatusId: number | null;
  departmentIds: number[];
}

/** What the entity received from the API actually carries. */
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

/** The fields an entity owns: the form only shows those. */
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

/** API URL segment for each entity. */
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

/** An integer, or `null` if the field is empty. An unreadable entry counts as empty. */
function frameValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * What to send: only the modified fields, and nothing for an entity that does not own them. Departments are
 * excluded: they go through their own route, which replaces the list instead of merging it.
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

/** The departments have moved (order irrelevant): no need to call their route otherwise. */
export function departmentsChanged(initial: EntityFormValues, values: EntityFormValues): boolean {
  if (initial.departmentIds.length !== values.departmentIds.length) return true;
  const before = new Set(initial.departmentIds);
  return values.departmentIds.some((id) => !before.has(id));
}

/**
 * A missing name is the only entry that can break an entity: everything else may be empty. An empty code would
 * pass the server's `min(1)` validation and come back as a raw error, so better say so here.
 */
export function formError(kind: EntityKind, values: EntityFormValues): 'name' | 'code' | null {
  if (values.name.trim() === '') return 'name';
  if (ENTITY_FIELDS[kind].has('code') && values.code.trim() === '') return 'code';
  return null;
}
