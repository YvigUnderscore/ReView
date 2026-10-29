// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { openConnection, type ConnectionContext } from './ShotgridConfigService';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { asDate, asNumber, asString, plainName, type SgRecord } from './shotgridMapper';
import { mapSgToLocal } from './shotgridLinks';
import { sgDeepLink } from './shotgridSettings';

/**
 * ReView <-> ShotGrid comparison.
 *
 * A synchronization may have missed events: instance stopped, webhook dropped, network cut. Rather than trusting the last timestamp,
 * this comparison reads both sides and enumerates the gaps, entity by entity, without changing anything. It answers a simple question:
 * "what does not match?"
 *
 * Nothing is corrected here. Correction is a separate, explicit gesture ("Realign everything on ShotGrid"), because overwriting work deserves a decision.
 */

export type DiffKind =
  | 'missing_local' // present in ShotGrid, absent from ReView
  | 'missing_remote' // present in ReView, absent from ShotGrid (or removed)
  | 'field_differs' // both exist, a value diverges
  | 'unlinked'; // local entity never linked

export interface DiffEntry {
  kind: DiffKind;
  entity: 'Sequence' | 'Shot' | 'Asset' | 'Task' | 'Version';
  name: string;
  sgId: number | null;
  localId: number | null;
  sgUrl: string | null;
  /** Field-by-field gaps, in values already readable. */
  fields?: Array<{ field: string; review: string | null; shotgrid: string | null }>;
}

export interface DiffReport {
  generatedAt: string;
  sgProjectId: number;
  sgProjectName: string;
  /** Does the remote project still carry the expected name? */
  projectNameOk: boolean;
  remoteProjectName: string | null;
  counts: Record<string, { review: number; shotgrid: number }>;
  entries: DiffEntry[];
  truncated: boolean;
}

const MAX_ENTRIES = 500;

function fieldDiff(
  field: string,
  review: unknown,
  shotgrid: unknown,
): { field: string; review: string | null; shotgrid: string | null } | null {
  const a = normalise(review);
  const b = normalise(shotgrid);
  if (a === b) return null;
  return { field, review: a, shotgrid: b };
}

function normalise(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return String(value);
  return String(value).trim() || null;
}

/**
 * Compares the content of both sides for the linked project.
 * Local entities placed in the trash are ignored: they are not gaps.
 */
export async function buildDiff(projectId: number): Promise<DiffReport> {
  const ctx = await openConnection(projectId, { verifyProject: false });
  const scope = {
    sgProjectId: ctx.connection.sgProjectId,
    sgProjectName: ctx.connection.sgProjectName,
  };
  const filters = [projectFilter(scope.sgProjectId)];
  const entries: DiffEntry[] = [];

  const remoteProject = await ctx.client.findById('Project', scope.sgProjectId, ['name']);
  const remoteProjectName = asString(remoteProject?.name);
  const projectNameOk =
    remoteProjectName !== null &&
    remoteProjectName.trim().toLocaleLowerCase() === scope.sgProjectName.trim().toLocaleLowerCase();

  const keep = (records: SgRecord[]) => records.filter((r) => belongsToProject(r, scope).ok);

  const [sgSequences, sgShots, sgAssets, sgTasks, sgVersions] = await Promise.all([
    // `sg_status_list` requested: the comparison screen only looked at the code, so a diverging sequence status
    // stayed invisible: the only entity whose gap was visible nowhere.
    ctx.client
      .search('Sequence', { fields: ['code', 'sg_status_list', 'updated_at', 'project'], filters })
      .then(keep),
    ctx.client
      .search('Shot', {
        fields: ['code', 'sg_cut_in', 'sg_cut_out', 'sg_status_list', 'sg_sequence', 'updated_at', 'project'],
        filters,
      })
      .then(keep),
    ctx.client
      .search('Asset', { fields: ['code', 'sg_asset_type', 'updated_at', 'project'], filters })
      .then(keep),
    ctx.client
      .search('Task', {
        fields: ['content', 'sg_status_list', 'start_date', 'due_date', 'entity', 'updated_at', 'project'],
        filters,
      })
      .then(keep),
    ctx.client
      .search('Version', { fields: ['code', 'sg_status_list', 'updated_at', 'project'], filters })
      .then(keep),
  ]);

  const [seqLinks, shotLinks, assetLinks, taskLinks, versionLinks] = await Promise.all([
    mapSgToLocal(ctx.connection.id, 'sequence'),
    mapSgToLocal(ctx.connection.id, 'shot'),
    mapSgToLocal(ctx.connection.id, 'asset'),
    mapSgToLocal(ctx.connection.id, 'task'),
    mapSgToLocal(ctx.connection.id, 'version'),
  ]);

  const [sequences, shots, assets, tasks, versions] = await Promise.all([
    prisma.sequence.findMany({ where: { projectId, deletedAt: null }, include: { pipelineStatus: true } }),
    prisma.shot.findMany({ where: { projectId, deletedAt: null }, include: { pipelineStatus: true } }),
    prisma.asset.findMany({ where: { projectId, deletedAt: null } }),
    prisma.task.findMany({
      where: { OR: [{ shot: { projectId } }, { asset: { projectId } }] },
      include: { pipelineStatus: true },
    }),
    prisma.version.findMany({
      where: {
        deletedAt: null,
        OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
      },
      include: { reviewStatus: true },
    }),
  ]);

  const url = (type: string, id: number) => sgDeepLink(ctx.connection.site.baseUrl, type, id);

  // ── Sequences
  for (const sg of sgSequences) {
    const link = seqLinks.get(sg.id);
    const local = link ? sequences.find((s) => s.id === link.localId) : undefined;
    const name = asString(sg.code) ?? `#${sg.id}`;
    if (!local) {
      entries.push({
        kind: 'missing_local',
        entity: 'Sequence',
        name,
        sgId: sg.id,
        localId: null,
        sgUrl: url('Sequence', sg.id),
      });
      continue;
    }
    const diffs = [
      fieldDiff('code', plainName(local.code, sg.id), asString(sg.code)),
      fieldDiff('status', local.pipelineStatus?.code ?? null, asString(sg.sg_status_list)),
    ].filter(Boolean);
    if (diffs.length)
      entries.push({
        kind: 'field_differs',
        entity: 'Sequence',
        name,
        sgId: sg.id,
        localId: local.id,
        sgUrl: url('Sequence', sg.id),
        fields: diffs as DiffEntry['fields'],
      });
  }
  for (const local of sequences) {
    const linked = [...seqLinks.values()].some((l) => l.localId === local.id);
    if (!linked)
      entries.push({
        kind: 'unlinked',
        entity: 'Sequence',
        name: local.code,
        sgId: null,
        localId: local.id,
        sgUrl: null,
      });
  }

  // ── Shots
  for (const sg of sgShots) {
    const link = shotLinks.get(sg.id);
    const local = link ? shots.find((s) => s.id === link.localId) : undefined;
    const name = asString(sg.code) ?? `#${sg.id}`;
    if (!local) {
      entries.push({
        kind: 'missing_local',
        entity: 'Shot',
        name,
        sgId: sg.id,
        localId: null,
        sgUrl: url('Shot', sg.id),
      });
      continue;
    }
    const diffs = [
      fieldDiff('code', plainName(local.code, sg.id), asString(sg.code)),
      fieldDiff('startFrame', local.startFrame, asNumber(sg.sg_cut_in)),
      fieldDiff('endFrame', local.endFrame, asNumber(sg.sg_cut_out)),
      fieldDiff('status', local.pipelineStatus?.code ?? null, asString(sg.sg_status_list)),
    ].filter(Boolean);
    if (diffs.length)
      entries.push({
        kind: 'field_differs',
        entity: 'Shot',
        name,
        sgId: sg.id,
        localId: local.id,
        sgUrl: url('Shot', sg.id),
        fields: diffs as DiffEntry['fields'],
      });
  }
  const linkedShotIds = new Set([...shotLinks.values()].map((l) => l.localId));
  const remoteShotIds = new Set(sgShots.map((s) => s.id));
  for (const local of shots) {
    if (!linkedShotIds.has(local.id)) {
      entries.push({
        kind: 'unlinked',
        entity: 'Shot',
        name: local.code,
        sgId: null,
        localId: local.id,
        sgUrl: null,
      });
      continue;
    }
    const link = [...shotLinks.values()].find((l) => l.localId === local.id);
    if (link && !remoteShotIds.has(link.sgId))
      entries.push({
        kind: 'missing_remote',
        entity: 'Shot',
        name: local.code,
        sgId: link.sgId,
        localId: local.id,
        sgUrl: url('Shot', link.sgId),
      });
  }

  // ── Assets
  for (const sg of sgAssets) {
    const link = assetLinks.get(sg.id);
    const local = link ? assets.find((a) => a.id === link.localId) : undefined;
    const name = asString(sg.code) ?? `#${sg.id}`;
    if (!local)
      entries.push({
        kind: 'missing_local',
        entity: 'Asset',
        name,
        sgId: sg.id,
        localId: null,
        sgUrl: url('Asset', sg.id),
      });
  }

  // ── Tasks
  for (const sg of sgTasks) {
    const link = taskLinks.get(sg.id);
    const local = link ? tasks.find((t) => t.id === link.localId) : undefined;
    const name = asString(sg.content) ?? `#${sg.id}`;
    if (!local) {
      entries.push({
        kind: 'missing_local',
        entity: 'Task',
        name,
        sgId: sg.id,
        localId: null,
        sgUrl: url('Task', sg.id),
      });
      continue;
    }
    const diffs = [
      fieldDiff('name', local.name, asString(sg.content)),
      fieldDiff('status', local.pipelineStatus?.code ?? null, asString(sg.sg_status_list)),
      fieldDiff('startDate', local.startDate, asDate(sg.start_date)),
      fieldDiff('dueDate', local.dueDate, asDate(sg.due_date)),
    ].filter(Boolean);
    if (diffs.length)
      entries.push({
        kind: 'field_differs',
        entity: 'Task',
        name,
        sgId: sg.id,
        localId: local.id,
        sgUrl: url('Task', sg.id),
        fields: diffs as DiffEntry['fields'],
      });
  }

  // ── Versions
  for (const sg of sgVersions) {
    const link = versionLinks.get(sg.id);
    const local = link ? versions.find((v) => v.id === link.localId) : undefined;
    const name = asString(sg.code) ?? `#${sg.id}`;
    if (!local) {
      entries.push({
        kind: 'missing_local',
        entity: 'Version',
        name,
        sgId: sg.id,
        localId: null,
        sgUrl: url('Version', sg.id),
      });
      continue;
    }
    const expected = ctx.settings.versionStatusMap[asString(sg.sg_status_list) ?? ''] ?? null;
    if (expected !== null && local.reviewStatusId !== expected)
      entries.push({
        kind: 'field_differs',
        entity: 'Version',
        name,
        sgId: sg.id,
        localId: local.id,
        sgUrl: url('Version', sg.id),
        fields: [
          {
            field: 'reviewStatus',
            review: local.reviewStatus?.name ?? null,
            shotgrid: asString(sg.sg_status_list),
          },
        ],
      });
  }

  return {
    generatedAt: new Date().toISOString(),
    sgProjectId: scope.sgProjectId,
    sgProjectName: scope.sgProjectName,
    projectNameOk,
    remoteProjectName,
    counts: {
      Sequence: { review: sequences.length, shotgrid: sgSequences.length },
      Shot: { review: shots.length, shotgrid: sgShots.length },
      Asset: { review: assets.length, shotgrid: sgAssets.length },
      Task: { review: tasks.length, shotgrid: sgTasks.length },
      Version: { review: versions.length, shotgrid: sgVersions.length },
    },
    entries: entries.slice(0, MAX_ENTRIES),
    truncated: entries.length > MAX_ENTRIES,
  };
}

export type { ConnectionContext };
