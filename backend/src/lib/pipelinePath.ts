// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { badRequest } from './errors';

/**
 * Pipeline paths (API v1) — PURE analysis, tested.
 *
 * A DCC does not know database identifiers: it knows names, those of the scene open in Maya or of the shot Prism has just
 * published. A path strings them together and becomes the address of an entity:
 *
 *   PROJ                              project
 *   PROJ/SQ010                        sequence
 *   PROJ/SQ010/SH0100                 shot
 *   PROJ/SQ010/SH0100/anim            task
 *   PROJ/SQ010/SH0100/anim/v003       version
 *   PROJ/SQ010/SH0100/layout:main     task "main" of the "layout" department
 *   PROJ/shots/SH0100[/anim[/v003]]   shot attached to no sequence
 *   PROJ/assets/hero[/model[/v003]]   reusable asset
 *
 * The segments `shots` and `assets` are branch keywords: they remove the ambiguity between "a sequence named X" and "a shot
 * named X without a sequence". Resolution in the database (case-insensitive, by code or by name) lives in
 * `services/PipelineResolveService`.
 *
 * The department is prefixed to the task name rather than taking a segment of its own: pipelines commonly name the task of
 * each department `main`, and one more positional segment would make `.../modeling/main` indistinguishable from `.../anim/v003`.
 */

/** Branch keywords, reserved in second position. */
export const PATH_KEYWORDS = ['shots', 'assets'] as const;

export type PipelineEntityKind = 'project' | 'sequence' | 'shot' | 'asset' | 'task' | 'version';

export interface PipelinePath {
  project: string;
  sequence?: string;
  shot?: string;
  asset?: string;
  task?: string;
  /** Department carried by the task segment (`layout:main`), absent otherwise. */
  department?: string;
  version?: string;
  /** Type of the last designated entity — what the path actually addresses. */
  kind: PipelineEntityKind;
}

const MAX_SEGMENTS = 6;
const MAX_SEGMENT_LENGTH = 200;

/** Splits and validates the raw segments (strict bounds: the path comes from the network). */
function splitSegments(raw: string): string[] {
  const segments = raw
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) throw badRequest('Empty path', 'PATH_EMPTY');
  if (segments.length > MAX_SEGMENTS) throw badRequest('Path is too deep', 'PATH_TOO_DEEP');
  for (const s of segments) {
    if (s.length > MAX_SEGMENT_LENGTH) throw badRequest('Path segment is too long', 'PATH_SEGMENT_TOO_LONG');
  }
  return segments;
}

/**
 * Splits `department:task`. Without a colon, the whole segment is the task name — this is the historical form, and it must
 * keep working as-is.
 */
function splitTaskSegment(segment?: string): { task?: string; department?: string } {
  if (!segment) return {};
  const at = segment.indexOf(':');
  if (at < 0) return { task: segment };
  const department = segment.slice(0, at).trim();
  const task = segment.slice(at + 1).trim();
  if (!department || !task)
    throw badRequest(
      'Malformed task segment: "department:task" expected on both sides of the colon',
      'PATH_TASK_MALFORMED',
    );
  return { task, department };
}

/** Branch `PROJ/assets/<asset>[/<task>[/<version>]]`. */
function parseAssetBranch(project: string, rest: string[]): PipelinePath {
  const [asset, taskSegment, version] = rest;
  if (!asset) throw badRequest('Incomplete asset path: asset name expected', 'PATH_INCOMPLETE');
  const { task, department } = splitTaskSegment(taskSegment);
  return {
    project,
    asset,
    task,
    department,
    version,
    kind: version ? 'version' : task ? 'task' : 'asset',
  };
}

/** Branch `PROJ/shots/<shot>[/<task>[/<version>]]` — shot without a sequence. */
function parseLooseShotBranch(project: string, rest: string[]): PipelinePath {
  const [shot, taskSegment, version] = rest;
  if (!shot) throw badRequest('Incomplete shot path: a shot code is expected', 'PATH_INCOMPLETE');
  const { task, department } = splitTaskSegment(taskSegment);
  return {
    project,
    shot,
    task,
    department,
    version,
    kind: version ? 'version' : task ? 'task' : 'shot',
  };
}

/** Branch `PROJ/<sequence>[/<shot>[/<task>[/<version>]]]`. */
function parseSequenceBranch(project: string, rest: string[]): PipelinePath {
  const [sequence, shot, taskSegment, version] = rest;
  const { task, department } = splitTaskSegment(taskSegment);
  return {
    project,
    sequence,
    shot,
    task,
    department,
    version,
    kind: version ? 'version' : task ? 'task' : shot ? 'shot' : 'sequence',
  };
}

/**
 * Parses a pipeline path. Throws an `AppError` 400 if the path is malformed — never a silent resolution: an approximate path must
 * be seen refused, not land on the wrong entity.
 */
export function parsePipelinePath(raw: string): PipelinePath {
  const segments = splitSegments(raw);
  const [project, ...rest] = segments;
  if (!project) throw badRequest('Empty path', 'PATH_EMPTY');
  if (rest.length === 0) return { project, kind: 'project' };

  const keyword = rest[0]?.toLowerCase();
  if (keyword === 'assets') return parseAssetBranch(project, rest.slice(1));
  if (keyword === 'shots') return parseLooseShotBranch(project, rest.slice(1));
  return parseSequenceBranch(project, rest);
}

/** Rebuilds the canonical path of an entity (API responses, logs, webhooks). */
export function formatPipelinePath(p: PipelinePath): string {
  const parts: string[] = [p.project];
  if (p.asset) parts.push('assets', p.asset);
  else if (p.shot && !p.sequence) parts.push('shots', p.shot);
  else {
    if (p.sequence) parts.push(p.sequence);
    if (p.shot) parts.push(p.shot);
  }
  if (p.task) parts.push(p.department ? `${p.department}:${p.task}` : p.task);
  if (p.version) parts.push(p.version);
  return parts.join('/');
}
