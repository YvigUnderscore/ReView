// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PipelineStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { ShotgridClient } from './ShotgridClient';
import {
  asString,
  asNumber,
  rgbToHex,
  sgStatusIsDone,
  sgStatusIsInactive,
  sgStatusToEnum,
} from './shotgridMapper';
import type { SyncJournal } from './ShotgridSyncJournal';

/**
 * Import of the ShotGrid status reference.
 *
 * Two sources are needed and neither suffices alone: the `Status` entity of the site gives the appearance (full name, colour, order) of all existing statuses;
 * the schema of `sg_status_list` says which ones are actually offered on Shot, Task or Version. Importing without the schema would fill ReView with statuses an artist
 * will never see; importing without the Status entity would give bare codes.
 */

export interface SgStatusInfo {
  code: string;
  name: string;
  color: string;
  order: number;
}

/** Site statuses, indexed by code. */
export async function fetchSiteStatuses(client: ShotgridClient): Promise<Map<string, SgStatusInfo>> {
  const records = await client.search('Status', {
    fields: ['code', 'name', 'bg_color', 'list_order'],
    maxRecords: 500,
  });
  const out = new Map<string, SgStatusInfo>();
  for (const r of records) {
    const code = asString(r.code);
    if (!code) continue;
    out.set(code, {
      code,
      name: asString(r.name) ?? code,
      color: rgbToHex(r.bg_color),
      order: asNumber(r.list_order) ?? 0,
    });
  }
  return out;
}

/** Codes actually offered for `sg_status_list` on a given entity. */
export async function fetchValidStatusCodes(client: ShotgridClient, entity: string): Promise<string[]> {
  const field = await client.schemaField(entity, 'sg_status_list');
  if (!field) return [];
  const properties = field.properties as Record<string, { value?: unknown }> | undefined;
  const valid = properties?.valid_values?.value;
  return Array.isArray(valid) ? valid.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Updates the `PipelineStatus` reference of a scope (task or shot).
 *
 * Existing statuses are updated, new ones created; none is deleted — a ReView task may still carry a status removed from the site, and making it lose its status
 * would be worse than keeping an obsolete entry.
 */
export async function syncPipelineStatuses(
  client: ShotgridClient,
  scope: 'task' | 'shot' | 'sequence' | 'asset',
  siteStatuses: Map<string, SgStatusInfo>,
  journal?: SyncJournal,
): Promise<Map<string, PipelineStatus>> {
  // Each entity has ITS list: four statuses on a sequence, fifteen on a shot. Confusing them would offer states the site would refuse on writing.
  const entity =
    scope === 'task' ? 'Task' : scope === 'shot' ? 'Shot' : scope === 'asset' ? 'Asset' : 'Sequence';
  const codes = await fetchValidStatusCodes(client, entity);
  const out = new Map<string, PipelineStatus>();

  if (codes.length === 0) {
    await journal?.log('warn', 'shotgrid.log.noStatusSchema', { entity });
    // Same filter as the nominal path: without `projectId: null` or `origin: 'shotgrid'`, this fallback picked up the studio's local statuses — and those of other
    // projects — then stuck them onto the site's entities. A shot could receive the status of a neighbouring project carrying the same code. A blank map is better than a wrong one.
    const existing = await prisma.pipelineStatus.findMany({
      where: { projectId: null, scope, origin: 'shotgrid' },
    });
    return new Map(existing.map((s) => [s.code, s]));
  }

  for (const [index, code] of codes.entries()) {
    const info = siteStatuses.get(code) ?? {
      code,
      name: code.toUpperCase(),
      color: '#6B7280',
      order: index,
    };
    // Imported statuses live at studio level (`projectId: null`) and are told apart from local statuses by their origin (B2): one and the same code, "wtg" for
    // example, exists on both sides. Without the origin filter, the synchronization would overwrite the studio's local vocabulary with the site's.
    const existing = await prisma.pipelineStatus.findFirst({
      where: { projectId: null, scope, code, origin: 'shotgrid' },
    });
    const data = {
      name: info.name,
      color: info.color,
      order: info.order || index,
      isDone: sgStatusIsDone(code),
      isInactive: sgStatusIsInactive(code),
      // This status comes from the site: it will only be offered on the projects linked to it. Setting it here avoids having to guess the origin afterwards.
      origin: 'shotgrid',
      legacyStatus: sgStatusToEnum(code),
    };
    const status = existing
      ? await prisma.pipelineStatus.update({ where: { id: existing.id }, data })
      : await prisma.pipelineStatus.create({
          data: { projectId: null, scope, code, ...data, isDefault: index === 0 && scope === 'shot' },
        });
    out.set(code, status);
    journal?.count(`statuses.${scope}`, existing ? 'updated' : 'created');
  }

  // Imported statuses absent from the site: kept, but flagged once. Purely local vocabulary is not concerned — it does not claim to reflect the site.
  const orphans = await prisma.pipelineStatus.findMany({
    where: { projectId: null, scope, origin: 'shotgrid', code: { notIn: codes } },
  });
  for (const orphan of orphans) {
    out.set(orphan.code, orphan);
    await journal?.log('info', 'shotgrid.log.statusNotOnSite', { code: orphan.code, scope });
  }
  return out;
}

/**
 * Version statuses -> ReView's `ReviewStatus`.
 *
 * Review decisions already exist on the ReView side with their own reference: we do not replace it, we complete what is missing and return the match
 * ShotGrid code -> local identifier, which the connection's settings remember.
 */
export async function syncVersionStatuses(
  client: ShotgridClient,
  siteStatuses: Map<string, SgStatusInfo>,
  existingMap: Record<string, number>,
  journal?: SyncJournal,
): Promise<Record<string, number>> {
  const codes = await fetchValidStatusCodes(client, 'Version');
  if (codes.length === 0) {
    await journal?.log('warn', 'shotgrid.log.noStatusSchema', { entity: 'Version' });
    return existingMap;
  }

  const all = await prisma.reviewStatus.findMany();
  const byName = new Map(all.map((s) => [s.name.toLocaleLowerCase(), s]));
  const byId = new Map(all.map((s) => [s.id, s]));
  const map: Record<string, number> = {};
  const unmapped: string[] = [];

  for (const [index, code] of codes.entries()) {
    // A match already set by hand takes precedence over any deduction.
    const configured = existingMap[code];
    if (configured && byId.has(configured)) {
      map[code] = configured;
      continue;
    }
    const info = siteStatuses.get(code) ?? { code, name: code.toUpperCase(), color: '#6B7280', order: index };
    const sameName = byName.get(info.name.toLocaleLowerCase());
    if (sameName) {
      map[code] = sameName.id;
      continue;
    }
    /*
     * No automatic creation.
     *
     * `fetchValidStatusCodes(client, 'Version')` returns the `valid_values` of the Version status field — on a studio site, this is the status list of the WHOLE site,
     * shared with Task and Shot. Creating one `ReviewStatus` per code filled the review-decision table with task statuses: the demo studio counted twenty-two of them,
     * including "Waiting to Start", "In Progress" and "Complete", with five approval duplicates and "Omit" next to "Omitted". The "All decisions" filter of the
     * Reviews page became unusable as a result.
     *
     * A review decision is a studio choice, not an import: the unknown code is flagged in the journal, and the administrator attaches it themselves from
     * Admin > Review statuses. A match already set by hand, for its part, continues to be respected (see above) — that is the normal path.
     */
    unmapped.push(code);
    journal?.count('statuses.version', 'skipped');
    await journal?.log('warn', 'shotgrid.log.reviewStatusUnmapped', { code, name: info.name });
  }
  if (unmapped.length > 0) {
    logger.info(
      { codes: unmapped },
      '[ShotGrid] Version statuses with no matching review decision — map them in Admin › Statuses',
    );
  }
  return map;
}

/** Reverse map (ReviewStatus identifier -> ShotGrid code) for writing. */
export function inverseVersionStatusMap(map: Record<string, number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [code, id] of Object.entries(map)) if (!out.has(id)) out.set(id, code);
  return out;
}

/**
 * Finds the ShotGrid status code matching a review decision, **without creating or writing anything**.
 *
 * `versionStatusMap` is only fed by the synchronization, and only when the reading of the "Status reference" is open. Unticking this setting therefore emptied the map,
 * and the sending of review decisions stopped — with no message, and no obvious link between the unticked box and the symptom. Here, the match is re-deduced on the fly by name,
 * exactly as in `syncVersionStatuses`, but read-only: an artist's decision has no business creating a status in the studio's reference.
 */
export async function resolveVersionStatusCode(
  client: ShotgridClient,
  reviewStatusId: number,
): Promise<string | null> {
  const status = await prisma.reviewStatus.findUnique({ where: { id: reviewStatusId } });
  if (!status) return null;
  const codes = await fetchValidStatusCodes(client, 'Version');
  if (codes.length === 0) return null;
  const siteStatuses = await fetchSiteStatuses(client);
  const wanted = status.name.toLocaleLowerCase();
  for (const code of codes) {
    const name = siteStatuses.get(code)?.name ?? code.toUpperCase();
    if (name.toLocaleLowerCase() === wanted) return code;
  }
  return null;
}

/** Statuses of a scope, indexed by code — used by the synchronization engine. */
export async function loadPipelineStatuses(
  scope: 'task' | 'shot' | 'sequence' | 'asset',
): Promise<Map<string, PipelineStatus>> {
  const list = await prisma.pipelineStatus.findMany({ where: { scope } });
  return new Map(list.map((s) => [s.code, s]));
}
