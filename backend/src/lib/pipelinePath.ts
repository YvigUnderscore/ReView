// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { badRequest } from './errors';

/**
 * Chemins de pipeline (API v1) — analyse PURE, testée.
 *
 * Un DCC ne connaît pas les identifiants de la base : il connaît des noms, ceux du plan
 * ouvert dans Maya ou du shot que Prism vient de publier. Un chemin les met bout à bout
 * et devient l'adresse d'une entité :
 *
 *   PROJ                              projet
 *   PROJ/SQ010                        séquence
 *   PROJ/SQ010/SH0100                 shot
 *   PROJ/SQ010/SH0100/anim            tâche
 *   PROJ/SQ010/SH0100/anim/v003       version
 *   PROJ/SQ010/SH0100/layout:main     tâche « main » du département « layout »
 *   PROJ/shots/SH0100[/anim[/v003]]   shot rattaché à aucune séquence
 *   PROJ/assets/hero[/model[/v003]]   asset réutilisable
 *
 * Les segments `shots` et `assets` sont des mots-clés de branche : ils lèvent l'ambiguïté
 * entre « une séquence nommée X » et « un shot nommé X sans séquence ». La résolution en
 * base (insensible à la casse, par code ou par nom) vit dans `services/PipelineResolveService`.
 *
 * Le département se préfixe au nom de tâche plutôt que d'occuper un segment à lui : les
 * pipelines nomment couramment `main` la tâche de chaque département, et un chemin
 * positionnel de plus rendrait `.../modeling/main` indistinguable de `.../anim/v003`.
 */

/** Mots-clés de branche, réservés en deuxième position. */
export const PATH_KEYWORDS = ['shots', 'assets'] as const;

export type PipelineEntityKind = 'project' | 'sequence' | 'shot' | 'asset' | 'task' | 'version';

export interface PipelinePath {
  project: string;
  sequence?: string;
  shot?: string;
  asset?: string;
  task?: string;
  /** Département porté par le segment de tâche (`layout:main`), absent sinon. */
  department?: string;
  version?: string;
  /** Type de la dernière entité désignée — ce que le chemin adresse réellement. */
  kind: PipelineEntityKind;
}

const MAX_SEGMENTS = 6;
const MAX_SEGMENT_LENGTH = 200;

/** Découpe et valide les segments bruts (bornes strictes : le chemin vient du réseau). */
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
 * Sépare `departement:tache`. Sans deux-points, tout le segment est le nom de la tâche —
 * c'est la forme historique, et elle doit continuer de fonctionner telle quelle.
 */
function splitTaskSegment(segment?: string): { task?: string; department?: string } {
  if (!segment) return {};
  const at = segment.indexOf(':');
  if (at < 0) return { task: segment };
  const department = segment.slice(0, at).trim();
  const task = segment.slice(at + 1).trim();
  if (!department || !task)
    throw badRequest(
      'Segment de tâche malformé : « département:tâche » attendu de part et d’autre du deux-points',
      'PATH_TASK_MALFORMED',
    );
  return { task, department };
}

/** Branche `PROJ/assets/<asset>[/<task>[/<version>]]`. */
function parseAssetBranch(project: string, rest: string[]): PipelinePath {
  const [asset, taskSegment, version] = rest;
  if (!asset) throw badRequest("Chemin d'asset incomplet : nom d'asset attendu", 'PATH_INCOMPLETE');
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

/** Branche `PROJ/shots/<shot>[/<task>[/<version>]]` — shot sans séquence. */
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

/** Branche `PROJ/<sequence>[/<shot>[/<task>[/<version>]]]`. */
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
 * Analyse un chemin de pipeline. Lève une `AppError` 400 si le chemin est malformé —
 * jamais de résolution silencieuse : un chemin approximatif doit se voir refusé, pas
 * atterrir sur la mauvaise entité.
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

/** Reconstruit le chemin canonique d'une entité (réponses de l'API, journaux, webhooks). */
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
