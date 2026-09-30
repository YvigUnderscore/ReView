// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Le protocole entre l'application et l'agent d'exploitation : la forme d'un ordre, celle
 * d'un statut, et les filtres que ni l'un ni l'autre ne franchit.
 *
 * Module **pur** : aucun accès disque, aucune dépendance à l'environnement. Ce qu'il
 * contient se teste sans monter quoi que ce soit, et c'est voulu — c'est ici que se joue
 * la différence entre « une étiquette de version » et « une ligne de commande ».
 *
 * ── Règle d'évolution ────────────────────────────────────────────────────────
 * Le protocole n'évolue qu'**additivement** : un champ nouveau, jamais un champ renommé ni
 * retiré. Un agent et un backend ne sont pas mis à jour au même instant — pendant une
 * bascule, c'est même précisément l'inverse — et le backend de la version N+1 doit relire
 * le statut d'un run lancé par l'agent de la version N.
 */

/** Version du protocole comprise par ce backend. */
export const OPS_PROTOCOL = 1;

/** Étiquette de version publiable, la même forme que celle qui déclenche `release.yml`. */
export const VERSION_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
/** Nom d'un dossier de sauvegarde, tel que `backup.sh` le compose. */
export const BACKUP_STAMP = /^\d{8}-\d{6}$/;
/** Identifiant d'exécution : horodatage + six hexadécimaux. C'est un NOM DE DOSSIER. */
export const RUN_ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/** Les trois opérations commandables. Il n'y en a pas de quatrième, et surtout pas libre. */
export const OPS_KINDS = ['update', 'backup', 'verify'] as const;
export type OpsKind = (typeof OPS_KINDS)[number];

/** États possibles d'une exécution, du dépôt de l'ordre au verdict. */
export const RUN_STATES = [
  'queued',
  'running',
  'succeeded',
  'rolled-back',
  'failed',
  'cancelled',
  'expired',
  'rejected',
  'unknown',
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Jalons émis par `scripts/update.sh` (`OPS_PHASE=`). */
export const RUN_PHASES = ['queued', 'precheck', 'backup', 'switch', 'health', 'rollback', 'done'] as const;

/**
 * Au-delà de ce jalon, la bascule est engagée : annuler ne défait rien et laisserait la
 * pile dans un état que personne ne sait décrire. L'agent refuse aussi de son côté.
 */
export const CANCELLABLE_PHASES = new Set<string>(['queued', 'precheck', 'backup']);

/** Un ordre, tel qu'il est écrit dans `ops/queue/<id>.json`. */
export interface OpsOrder {
  protocol: number;
  id: string;
  kind: OpsKind;
  createdAt: string;
  expiresAt: string;
  actor: { id: number; displayName: string };
  params: {
    version: string | null;
    backupId: string | null;
    skipBackup: boolean;
    readyTimeoutSec: number;
    maxRuntimeSec: number;
  };
}

/** Identifiant d'exécution — l'horodatage le rend triable, les six hexa non devinable. */
export function newRunId(now: Date, entropy: () => string = () => randomBytes(3).toString('hex')): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const stamp =
    `${p(now.getFullYear(), 4)}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${entropy()}`;
}

/**
 * Ramène une durée dans des bornes tenables. Ce n'est pas une politesse : la valeur finit
 * dans `$(( SECONDS + READY_TIMEOUT ))` côté script, où bash **ré-évalue le contenu** de
 * la variable — « x[$(commande)] » s'y exécuterait. Elle est donc bornée ici, refiltrée
 * par `update.sh`, et refiltrée encore par l'agent. Trois passes, aucune confiance.
 */
export function clampSeconds(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Construit l'ordre à déposer. Toutes les valeurs sont déjà validées à ce point. */
export function buildOrder(input: {
  id: string;
  kind: OpsKind;
  now: Date;
  ttlSec: number;
  actor: { id: number; displayName: string };
  version?: string | null;
  backupId?: string | null;
  skipBackup?: boolean;
  readyTimeoutSec?: number;
  maxRuntimeSec?: number;
}): OpsOrder {
  return {
    protocol: OPS_PROTOCOL,
    id: input.id,
    kind: input.kind,
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + clampSeconds(input.ttlSec, 60, 86_400) * 1000).toISOString(),
    actor: input.actor,
    params: {
      version: input.version ?? null,
      backupId: input.backupId ?? null,
      skipBackup: input.skipBackup === true,
      readyTimeoutSec: clampSeconds(input.readyTimeoutSec ?? 600, 60, 3_600),
      maxRuntimeSec: clampSeconds(input.maxRuntimeSec ?? 3_600, 60, 21_600),
    },
  };
}

/**
 * Le statut écrit par l'agent. Il est relu par un backend qui n'est pas forcément celui qui
 * a déposé l'ordre — d'où le schéma : tout est facultatif sauf ce sans quoi il n'y a rien à
 * montrer, et un champ inconnu est ignoré plutôt que de faire échouer la lecture.
 */
export const statusSchema = z.object({
  protocol: z.number().int().optional(),
  id: z.string(),
  kind: z.string(),
  target: z.string().nullish(),
  state: z.string(),
  phase: z.string().nullish(),
  reason: z.string().nullish(),
  startedAt: z.string().nullish(),
  heartbeatAt: z.string().nullish(),
  endedAt: z.string().nullish(),
  exitCode: z.number().nullish(),
  backupId: z.string().nullish(),
  actor: z.object({ id: z.number(), displayName: z.string() }).nullish(),
  agentVersion: z.string().nullish(),
});

/**
 * Un ordre relu depuis la file. Le backend l'y a écrit lui-même, mais il le relit pour dire
 * de QUOI il s'agit tant que l'agent ne l'a pas ramassé — sans quoi l'écran annoncerait une
 * opération « inconnue » pendant les secondes qui suivent le clic, ce qui est faux et
 * inquiétant. Schéma tolérant, comme le statut : un ordre déposé par une version antérieure
 * doit rester lisible.
 */
export const queuedOrderSchema = z.object({
  id: z.string(),
  kind: z.string(),
  createdAt: z.string().nullish(),
  expiresAt: z.string().nullish(),
  actor: z.object({ id: z.number(), displayName: z.string() }).nullish(),
  params: z.object({ version: z.string().nullish(), backupId: z.string().nullish() }).partial().nullish(),
});

/** L'état de l'agent (`ops/state/agent.json`), écrit à chaque battement. */
export const agentSchema = z.object({
  protocol: z.number().int(),
  version: z.string().nullish(),
  seenAt: z.string(),
  rootOk: z.boolean().nullish(),
  pollSec: z.number().nullish(),
  allow: z.object({ update: z.boolean(), backup: z.boolean(), verify: z.boolean() }).partial().nullish(),
});
