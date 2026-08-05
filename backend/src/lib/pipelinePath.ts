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
 *   PROJ/shots/SH0100[/anim[/v003]]   shot rattaché à aucune séquence
 *   PROJ/assets/hero[/model[/v003]]   asset réutilisable
 *
 * Les segments `shots` et `assets` sont des mots-clés de branche : ils lèvent l'ambiguïté
 * entre « une séquence nommée X » et « un shot nommé X sans séquence ». La résolution en
 * base (insensible à la casse, par code ou par nom) vit dans `services/PipelineResolveService`.
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
  if (segments.length === 0) throw badRequest('Chemin vide', 'PATH_EMPTY');
  if (segments.length > MAX_SEGMENTS) throw badRequest('Chemin trop profond', 'PATH_TOO_DEEP');
  for (const s of segments) {
    if (s.length > MAX_SEGMENT_LENGTH)
      throw badRequest('Segment de chemin trop long', 'PATH_SEGMENT_TOO_LONG');
  }
  return segments;
}

/** Branche `PROJ/assets/<asset>[/<task>[/<version>]]`. */
function parseAssetBranch(project: string, rest: string[]): PipelinePath {
  const [asset, task, version] = rest;
  if (!asset) throw badRequest("Chemin d'asset incomplet : nom d'asset attendu", 'PATH_INCOMPLETE');
  return {
    project,
    asset,
    task,
    version,
    kind: version ? 'version' : task ? 'task' : 'asset',
  };
}

/** Branche `PROJ/shots/<shot>[/<task>[/<version>]]` — shot sans séquence. */
function parseLooseShotBranch(project: string, rest: string[]): PipelinePath {
  const [shot, task, version] = rest;
  if (!shot) throw badRequest('Chemin de shot incomplet : code de shot attendu', 'PATH_INCOMPLETE');
  return {
    project,
    shot,
    task,
    version,
    kind: version ? 'version' : task ? 'task' : 'shot',
  };
}

/** Branche `PROJ/<sequence>[/<shot>[/<task>[/<version>]]]`. */
function parseSequenceBranch(project: string, rest: string[]): PipelinePath {
  const [sequence, shot, task, version] = rest;
  return {
    project,
    sequence,
    shot,
    task,
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
  if (!project) throw badRequest('Chemin vide', 'PATH_EMPTY');
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
  if (p.task) parts.push(p.task);
  if (p.version) parts.push(p.version);
  return parts.join('/');
}
