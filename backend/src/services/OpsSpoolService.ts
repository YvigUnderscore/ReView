// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import {
  agentSchema,
  CANCELLABLE_PHASES,
  OPS_PROTOCOL,
  RUN_ID,
  statusSchema,
  type OpsOrder,
  type RunState,
} from '../lib/opsOrder';
import { redactSecrets } from '../lib/opsRedact';

/**
 * Le seul module de l'application qui touche au spool de l'agent d'exploitation.
 *
 * Il **écrit** dans la file d'ordres et **lit** l'état — jamais l'inverse. Les deux chemins
 * sont montés séparément (`ops/queue` en écriture, `ops/state` en lecture seule) et cette
 * asymétrie est la vraie barrière : le backend est joignable depuis internet et tourne en
 * root ; s'il pouvait écrire dans l'état, il pourrait y poser un lien symbolique que
 * l'agent — qui détient le socket docker — suivrait ensuite en écriture.
 *
 * Rien de tout cela ne vit en base : l'état d'une opération doit survivre au conteneur qui
 * l'a demandée (c'est lui qu'on détruit), et se relire ensuite depuis un backend d'une
 * AUTRE version. Une restauration de base ne doit pas non plus rembobiner la trace de
 * l'opération qui l'a provoquée.
 */

/** Ce dont l'écran a besoin pour parler d'une exécution. */
export interface RunSummary {
  id: string;
  kind: string;
  target: string | null;
  state: RunState;
  phase: string | null;
  reason: string | null;
  requestedBy: { id: number; displayName: string } | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  backupId: string | null;
  agentVersion: string | null;
  /**
   * La commande de restauration correspondant à la sauvegarde de ce run, quand il y en a
   * une. Composée ici et non à l'écran : une ligne de shell appartient au module qui
   * connaît les scripts, et un texte fabriqué dans un composant échapperait au contrôle
   * des chaînes en dur du frontend.
   */
  restoreCommand: string | null;
  /** Annuler a-t-il encore un sens ? Faux dès que la bascule est engagée. */
  cancellable: boolean;
}

export type MechanismState = 'absent' | 'ready' | 'busy' | 'stalled' | 'blocked';

export interface Mechanism {
  state: MechanismState;
  /** SPOOL_UNSET · AGENT_NEVER_SEEN · AGENT_STALE · ROOT_MISMATCH · PROTOCOL_UNSUPPORTED */
  reason: string | null;
  protocol: number | null;
  agentVersion: string | null;
  seenAt: string | null;
  allow: { update: boolean; backup: boolean; verify: boolean };
}

/** Un état terminal ne bougera plus : l'écran cesse de sonder. */
const TERMINAL: ReadonlySet<RunState> = new Set<RunState>([
  'succeeded',
  'rolled-back',
  'failed',
  'cancelled',
  'expired',
  'rejected',
  'unknown',
]);

export const isTerminal = (state: RunState): boolean => TERMINAL.has(state);

/** Ce qu'on sert d'un journal en une fois : au-delà, on pagine par décalage d'octets. */
const LOG_CHUNK_BYTES = 256 * 1024;
/** Exécutions listées : l'écran en montre dix, l'historique replié vingt. */
const MAX_RUNS = 20;

const NO_ALLOW = { update: false, backup: false, verify: false };

/** Les deux chemins, ou `null` si l'exécution n'est pas branchée sur cette instance. */
function dirs(): { queue: string; state: string } | null {
  if (!env.OPS_QUEUE_DIR || !env.OPS_STATE_DIR) return null;
  return { queue: env.OPS_QUEUE_DIR, state: env.OPS_STATE_DIR };
}

export const isEnabled = (): boolean => dirs() !== null;

/** Secondes écoulées depuis un horodatage ISO ; `Infinity` s'il est illisible ou absent. */
function secondsSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : (Date.now() - at) / 1000;
}

/** Lit un JSON écrit par l'agent. Illisible ou mal formé : `null`, jamais d'exception. */
async function readJson<T>(
  path: string,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
) {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const result = schema.safeParse(parsed);
    return result.success ? (result.data as T) : null;
  } catch {
    return null;
  }
}

/** Transforme un `status.json` en résumé, en tranchant les cas que l'agent ne tranche pas. */
function summarize(status: NonNullable<Awaited<ReturnType<typeof readStatus>>>): RunSummary {
  let state = status.state as RunState;
  // Un run « en cours » dont l'agent ne bat plus n'est pas en cours : il est sans nouvelles.
  // Sans cette règle, l'écran afficherait une progression éternelle pour un agent mort.
  if (
    (state === 'running' || state === 'queued') &&
    secondsSince(status.heartbeatAt) > env.OPS_AGENT_STALE_SEC
  ) {
    state = 'unknown';
  }
  return {
    id: status.id,
    kind: status.kind,
    target: status.target ?? null,
    state,
    phase: status.phase ?? null,
    reason: status.reason ?? null,
    requestedBy: status.actor ?? null,
    startedAt: status.startedAt ?? null,
    endedAt: status.endedAt ?? null,
    exitCode: status.exitCode ?? null,
    backupId: status.backupId ?? null,
    agentVersion: status.agentVersion ?? null,
    restoreCommand: status.backupId ? `bash scripts/restore.sh db backups/${status.backupId}` : null,
    cancellable: state === 'running' && CANCELLABLE_PHASES.has(status.phase ?? 'queued'),
  };
}

const readStatus = (dir: string, id: string) => readJson(join(dir, 'runs', id, 'status.json'), statusSchema);

/** L'état de l'agent, et ce qu'il accepte d'exécuter. */
export async function mechanism(): Promise<Mechanism> {
  const paths = dirs();
  if (!paths) {
    return {
      state: 'absent',
      reason: 'SPOOL_UNSET',
      protocol: null,
      agentVersion: null,
      seenAt: null,
      allow: NO_ALLOW,
    };
  }
  const agent = await readJson(join(paths.state, 'agent.json'), agentSchema);
  if (!agent) {
    return {
      state: 'absent',
      reason: 'AGENT_NEVER_SEEN',
      protocol: null,
      agentVersion: null,
      seenAt: null,
      allow: NO_ALLOW,
    };
  }

  const allow = { ...NO_ALLOW, ...(agent.allow ?? {}) };
  const base = { protocol: agent.protocol, agentVersion: agent.version ?? null, seenAt: agent.seenAt, allow };

  if (secondsSince(agent.seenAt) > env.OPS_AGENT_STALE_SEC) {
    return { ...base, state: 'stalled', reason: 'AGENT_STALE' };
  }
  // Le dépôt n'est pas monté sur son chemin hôte : `backup.sh` écrirait son miroir dans le
  // vide, sans une erreur. Un refus net vaut mieux qu'une sauvegarde imaginaire.
  if (agent.rootOk === false) return { ...base, state: 'blocked', reason: 'ROOT_MISMATCH' };
  if (agent.protocol > OPS_PROTOCOL) return { ...base, state: 'blocked', reason: 'PROTOCOL_UNSUPPORTED' };
  if ((await activeRun()) !== null) return { ...base, state: 'busy', reason: null };
  return { ...base, state: 'ready', reason: null };
}

/** Dépose un ordre. Écriture temporaire puis renommage : l'agent ne lit jamais un demi-JSON. */
export async function enqueue(order: OpsOrder): Promise<void> {
  const paths = dirs();
  if (!paths) throw new Error('OPS spool disabled');
  const target = join(paths.queue, `${order.id}.json`);
  const tmp = join(paths.queue, `.${order.id}.json.tmp`);
  await writeFile(tmp, JSON.stringify(order), { mode: 0o600 });
  await rename(tmp, target);
  logger.info({ runId: order.id, kind: order.kind }, '[Ops] ordre déposé');
}

/**
 * Demande l'annulation. C'est une SENTINELLE, pas un ordre : l'agent la lit s'il en est
 * encore au stade où l'abandon ne casse rien, et l'ignore une fois la bascule engagée.
 */
export async function cancel(runId: string): Promise<void> {
  const paths = dirs();
  if (!paths || !RUN_ID.test(runId)) throw new Error('OPS spool disabled');
  await writeFile(join(paths.queue, `${runId}.cancel`), '', { mode: 0o600 });
}

/** Les ordres déposés que l'agent n'a pas encore ramassés. */
async function queuedRuns(paths: { queue: string; state: string }): Promise<RunSummary[]> {
  let names: string[];
  try {
    names = (await readdir(paths.queue)).filter((n) => n.endsWith('.json') && RUN_ID.test(n.slice(0, -5)));
  } catch {
    return [];
  }
  return names.map((name) => {
    const id = name.slice(0, -5);
    return {
      id,
      kind: 'unknown',
      target: null,
      state: 'queued',
      phase: 'queued',
      reason: null,
      requestedBy: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      backupId: null,
      agentVersion: null,
      restoreCommand: null,
      cancellable: true,
    };
  });
}

/** Les exécutions connues, la plus récente en tête (l'identifiant est horodaté, donc trié). */
export async function listRuns(limit = MAX_RUNS): Promise<RunSummary[]> {
  const paths = dirs();
  if (!paths) return [];

  let ids: string[];
  try {
    ids = (await readdir(join(paths.state, 'runs'), { withFileTypes: true }))
      .filter((e) => e.isDirectory() && RUN_ID.test(e.name))
      .map((e) => e.name);
  } catch {
    ids = [];
  }

  const done = (await Promise.all(ids.map((id) => readStatus(paths.state, id))))
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map(summarize);

  // Un ordre encore en file n'a pas de statut : il vient de l'autre source. Les deux
  // ensembles ne se recouvrent pas — l'agent supprime le fichier de file en le ramassant.
  const known = new Set(done.map((r) => r.id));
  const pending = (await queuedRuns(paths)).filter((r) => !known.has(r.id));

  return [...done, ...pending].sort((a, b) => b.id.localeCompare(a.id)).slice(0, limit);
}

/** L'exécution en cours, s'il y en a une. C'est elle qui verrouille les boutons. */
export async function activeRun(): Promise<RunSummary | null> {
  const runs = await listRuns(MAX_RUNS);
  return runs.find((r) => r.state === 'queued' || r.state === 'running') ?? null;
}

export async function readRun(id: string): Promise<RunSummary | null> {
  const paths = dirs();
  if (!paths || !RUN_ID.test(id)) return null;
  const status = await readStatus(paths.state, id);
  if (status) return summarize(status);
  return (await queuedRuns(paths)).find((r) => r.id === id) ?? null;
}

/**
 * Une tranche du journal, à partir d'un décalage en octets.
 *
 * Le fichier est écrit en APPEND seulement — c'est ce qui rend le décalage fiable à travers
 * un redémarrage du backend, et donc ce qui permet à l'écran de reprendre sa lecture là où
 * il en était après la coupure d'une mise à jour.
 */
export async function readLog(
  id: string,
  from = 0,
): Promise<{ from: number; next: number; text: string; truncated: boolean }> {
  const paths = dirs();
  const empty = { from: 0, next: 0, text: '', truncated: false };
  if (!paths || !RUN_ID.test(id)) return empty;

  const path = join(paths.state, 'runs', id, 'output.log');
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return empty;
  }

  const start = Math.min(Math.max(0, Math.trunc(from)), size);
  const length = Math.min(size - start, LOG_CHUNK_BYTES);
  if (length <= 0) return { from: start, next: size, text: '', truncated: false };

  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return {
      from: start,
      next: start + bytesRead,
      // Caviardé ICI, au plus près de la sortie : le script, lui, n'a jamais à connaître
      // la liste des secrets, et un `sed` construit sur un mot de passe se casserait sur
      // le premier caractère spécial venu.
      text: redactSecrets(buffer.subarray(0, bytesRead).toString('utf8')),
      truncated: start + bytesRead < size,
    };
  } finally {
    await handle.close();
  }
}
