// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';
import { logger } from './logger';
import { logAudit } from '../services/AuditService';

/**
 * Rétention des journaux — cycle de vie des tables qui ne cessent de croître.
 *
 * Neuf tables enregistrent l'activité sans jamais rien rendre : audit, accès aux médias,
 * notifications, sessions, resets de mot de passe, invitations, liens de partage, passes
 * de synchronisation ShotGrid et journal d'événements de l'API v1. À la volumétrie d'un
 * long-métrage (2000 shots, 50 personnes, ~20 000 versions) elles finissent par peser plus
 * lourd que les données de production elles-mêmes — et elles contiennent des données
 * personnelles (adresses IP, identités, horodatages) qu'aucun studio ne peut conserver
 * indéfiniment sans le justifier.
 *
 * Deux garanties tenues ici :
 *  1. **une durée par famille**, réglable par l'administration, `0` = conservation illimitée
 *     (même convention que `trash_retention_days`) ;
 *  2. **une suppression par tranches plafonnées** — jamais un `DELETE` de plusieurs millions
 *     de lignes qui verrouillerait la table pendant que le studio travaille. Chaque passe a
 *     un budget ; ce qui dépasse attend la passe suivante.
 *
 * Ce qui n'est JAMAIS supprimé, quelle que soit la durée :
 *  - une session encore valide (seules les révoquées/expirées depuis N jours partent) ;
 *  - un lien de partage actif (seuls les révoqués/expirés depuis N jours partent) ;
 *  - une passe ShotGrid qui porte encore un conflit non arbitré.
 *
 * Politique et valeurs par défaut : `DOCUMENTATION/admin-guide/data-retention.md`.
 */

/** Familles de journaux soumises à rétention, dans l'ordre d'affichage de l'administration. */
export const RETENTION_FAMILIES = [
  'auditLog',
  'mediaAccessLog',
  'notification',
  'userSession',
  'passwordReset',
  'invitation',
  'shareLink',
  'shotgridSync',
  'apiEvent',
] as const;

export type RetentionFamily = (typeof RETENTION_FAMILIES)[number];

/** Durées en jours (`0` = conservation illimitée) + taille des tranches de suppression. */
export type RetentionPolicy = Record<RetentionFamily, number> & { batchSize: number };

/**
 * Valeurs par défaut. Elles répondent à une question simple : « combien de temps le studio
 * a-t-il besoin de cette trace ? »
 *  - audit et accès média : **1 an**, la durée que réclame un audit de sécurité ou un
 *    ayant droit qui demande qui a vu quoi ;
 *  - notifications : **90 jours**, la cloche ne montre que le récent ;
 *  - sessions / invitations / partages : la trace ne sert plus une fois l'objet mort ;
 *  - resets de mot de passe : **7 jours**, un jeton consommé n'a plus aucune valeur ;
 *  - synchro ShotGrid : **90 jours**, de quoi expliquer une divergence de la saison ;
 *  - événements API v1 : **30 jours**, la valeur historique du curseur `GET /api/v1/events`.
 */
export const RETENTION_DEFAULTS: RetentionPolicy = {
  auditLog: 365,
  mediaAccessLog: 365,
  notification: 90,
  userSession: 30,
  passwordReset: 7,
  invitation: 90,
  shareLink: 180,
  shotgridSync: 90,
  apiEvent: 30,
  batchSize: 2000,
};

const RETENTION_KEY = 'retention_policy';

/** Dix ans : au-delà, la durée ne veut plus rien dire — autant écrire `0`. */
const MAX_DAYS = 3650;
const MIN_BATCH = 100;
const MAX_BATCH = 20_000;

/** Budget d'une passe automatique : 200 tranches × 2000 lignes = 400 000 lignes par famille. */
export const MAX_BATCHES_PER_FAMILY = 200;

/** Budget d'un déclenchement manuel : borné pour que la requête HTTP réponde. */
export const MANUAL_MAX_BATCHES = 10;

/** Respiration entre deux tranches : la base sert aussi les 50 personnes qui travaillent. */
export const BATCH_PAUSE_MS = 25;

const clampDays = (value: unknown, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(Math.round(Number(value)), 0), MAX_DAYS) : fallback;

function sanitize(raw: unknown, base: RetentionPolicy): RetentionPolicy {
  const o = (raw ?? {}) as Partial<Record<keyof RetentionPolicy, unknown>>;
  const out = { ...base };
  for (const family of RETENTION_FAMILIES) out[family] = clampDays(o[family], base[family]);
  out.batchSize = Number.isFinite(o.batchSize)
    ? Math.min(Math.max(Math.round(Number(o.batchSize)), MIN_BATCH), MAX_BATCH)
    : base.batchSize;
  return out;
}

const daysField = z.number().int().min(0).max(MAX_DAYS).optional();

export const retentionPolicySchema = z.object({
  auditLog: daysField,
  mediaAccessLog: daysField,
  notification: daysField,
  userSession: daysField,
  passwordReset: daysField,
  invitation: daysField,
  shareLink: daysField,
  shotgridSync: daysField,
  apiEvent: daysField,
  batchSize: z.number().int().min(MIN_BATCH).max(MAX_BATCH).optional(),
});

export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const row = await prisma.setting.findUnique({ where: { key: RETENTION_KEY } });
  if (!row) return { ...RETENTION_DEFAULTS };
  try {
    return sanitize(JSON.parse(row.value), RETENTION_DEFAULTS);
  } catch {
    return { ...RETENTION_DEFAULTS };
  }
}

export async function setRetentionPolicy(value: unknown): Promise<RetentionPolicy> {
  const clean = sanitize(value, await getRetentionPolicy());
  const serialized = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: RETENTION_KEY },
    update: { value: serialized },
    create: { key: RETENTION_KEY, value: serialized },
  });
  return clean;
}

// ── Suppression par tranches ─────────────────────────────────────────────────────

/** Identifiant de ligne : entier partout, sauf `UserSession` dont le `sid` est une chaîne. */
type RowId = number | string;

export interface BatchDeleter {
  /** Au plus `take` identifiants de lignes expirées, les plus anciennes d'abord. */
  findExpiredIds(cutoff: Date, take: number): Promise<RowId[]>;
  deleteByIds(ids: RowId[]): Promise<number>;
}

export interface BatchBudget {
  batchSize: number;
  maxBatches: number;
  pauseMs?: number;
  /** Injectable pour les tests — sinon `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Supprime les lignes expirées par tranches. S'arrête net au plafond de tranches en
 * signalant `truncated` : le reste part à la passe suivante, la base n'est jamais bloquée
 * par une suppression massive.
 */
export async function deleteInBatches(
  deleter: BatchDeleter,
  cutoff: Date,
  budget: BatchBudget,
): Promise<{ deleted: number; truncated: boolean }> {
  const sleep = budget.sleep ?? defaultSleep;
  const pauseMs = budget.pauseMs ?? 0;
  let deleted = 0;

  for (let batch = 0; batch < budget.maxBatches; batch += 1) {
    const ids = await deleter.findExpiredIds(cutoff, budget.batchSize);
    if (ids.length === 0) return { deleted, truncated: false };
    deleted += await deleter.deleteByIds(ids);
    // Tranche incomplète = plus rien à prendre : inutile d'interroger la base une fois de plus.
    if (ids.length < budget.batchSize) return { deleted, truncated: false };
    // Respiration entre deux tranches — pas après la dernière, on rend la main aussitôt.
    if (pauseMs > 0 && batch + 1 < budget.maxBatches) await sleep(pauseMs);
  }
  return { deleted, truncated: true };
}

// ── Une famille = un couple (sélection des expirés, suppression) ─────────────────

interface FamilySpec extends BatchDeleter {
  /**
   * Diviseur de tranche : une suppression qui cascade emporte bien plus de lignes qu'elle
   * n'en cible (une passe ShotGrid porte jusqu'à 2000 lignes de journal).
   */
  batchDivisor: number;
}

const pickIds = (rows: { id: RowId }[]): RowId[] => rows.map((r) => r.id);

/**
 * Tri par identifiant croissant : la clé primaire est un compteur, les plus petits
 * identifiants sont donc les plus vieilles lignes — celles que la purge cherche. Postgres
 * lit l'index primaire par le début et s'arrête dès la tranche remplie.
 */
const OLDEST_FIRST = { id: 'asc' } as const;

const SPECS: Record<RetentionFamily, FamilySpec> = {
  auditLog: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.auditLog
        .findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: OLDEST_FIRST, take })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.auditLog.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  mediaAccessLog: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.mediaAccessLog
        .findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: OLDEST_FIRST, take })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.mediaAccessLog.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  notification: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.notification
        .findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: OLDEST_FIRST, take })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.notification.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  // Jamais une session vivante : `expiresAt`/`revokedAt` sont dans le passé de la coupure.
  userSession: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.userSession
        .findMany({
          where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.userSession.deleteMany({ where: { id: { in: ids as string[] } } }).then((r) => r.count),
  },
  // Jeton consommé ou périmé depuis plus longtemps que la durée : il n'ouvre plus rien.
  passwordReset: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.passwordReset
        .findMany({
          where: { OR: [{ used: true, createdAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: OLDEST_FIRST,
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.passwordReset.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  // Une invitation acceptée ou périmée ne sert plus : le compte existe, ou il faut réinviter.
  invitation: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.invitation
        .findMany({
          where: { OR: [{ acceptedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: OLDEST_FIRST,
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.invitation.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  // Un lien sans expiration et non révoqué reste actif : il n'est jamais concerné.
  shareLink: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.shareLink
        .findMany({
          where: { OR: [{ revoked: true, createdAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: OLDEST_FIRST,
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.shareLink.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  // La passe emporte ses lignes de journal (cascade) — sauf si un conflit attend son arbitrage.
  shotgridSync: {
    batchDivisor: 10,
    findExpiredIds: (cutoff, take) =>
      prisma.shotgridSyncRun
        .findMany({
          where: {
            finishedAt: { lt: cutoff },
            logs: { none: { level: 'conflict', resolvedAt: null } },
          },
          select: { id: true },
          orderBy: OLDEST_FIRST,
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.shotgridSyncRun.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  apiEvent: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.apiEvent
        .findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: OLDEST_FIRST, take })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.apiEvent.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
};

export interface SweepResult {
  /** Lignes supprimées par famille (0 pour une famille en conservation illimitée). */
  families: Record<RetentionFamily, number>;
  total: number;
  /** Vrai si au moins une famille a atteint son plafond : la passe suivante continuera. */
  truncated: boolean;
}

export interface SweepOptions {
  policy?: RetentionPolicy;
  maxBatches?: number;
  now?: Date;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Balaye toutes les familles. Une famille en échec (table verrouillée, migration en cours)
 * est journalisée et n'empêche pas les autres de passer — un incident local ne doit pas
 * geler tout le cycle de vie des données.
 */
export async function sweepRetention(options: SweepOptions = {}): Promise<SweepResult> {
  const policy = options.policy ?? (await getRetentionPolicy());
  const now = options.now ?? new Date();
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_FAMILY;
  const families = Object.fromEntries(RETENTION_FAMILIES.map((f) => [f, 0])) as Record<
    RetentionFamily,
    number
  >;
  let total = 0;
  let truncated = false;

  for (const family of RETENTION_FAMILIES) {
    const days = policy[family];
    if (days <= 0) continue; // 0 = conservation illimitée, décidée par l'administration
    const spec = SPECS[family];
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const batchSize = Math.max(MIN_BATCH, Math.floor(policy.batchSize / spec.batchDivisor));
    try {
      const result = await deleteInBatches(spec, cutoff, {
        batchSize,
        maxBatches,
        pauseMs: options.pauseMs ?? BATCH_PAUSE_MS,
        sleep: options.sleep,
      });
      families[family] = result.deleted;
      total += result.deleted;
      truncated = truncated || result.truncated;
    } catch (err) {
      logger.error({ err, family }, '[retention] balayage interrompu pour cette famille');
    }
  }

  if (total > 0) {
    logger.info({ families, truncated }, '[retention] balayage terminé');
    // Trace consultable dans l'écran d'audit : un studio doit pouvoir montrer QUAND il purge.
    logAudit({ action: 'RETENTION_SWEEP', entityType: 'Setting', metadata: { families, truncated } });
  }
  return { families, total, truncated };
}

export const __testing = { sanitize, RETENTION_KEY };
