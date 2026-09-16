// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { displayName, initials, avatarUrl } from '../lib/userView';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';

/**
 * Journal d'audit (Phase 21) : écriture (`logAudit`) et lecture paginée (`list`).
 *
 * Deux propriétés tenues ici, parce qu'un journal qui ne les a pas ne sert à rien le jour
 * où on le consulte :
 *
 * 1. **Le `metadata` est restitué.** Il était écarté de la réponse : l'écran d'audit
 *    affichait « MEDIA_PURGE · MediaObject · 812 » sans dire lesquels des trois cents
 *    identifiants du lot étaient partis. Il est désormais rendu — mais *rédigé* (voir
 *    `redactAuditMetadata`), parce qu'on y trouve aussi bien des identifiants anodins
 *    qu'une URL de webhook dont le chemin EST le secret.
 * 2. **La trace sort du périmètre de l'API.** Chaque entrée est aussi émise sur le
 *    journal pino, que la politique de rétention ne peut pas purger : un administrateur
 *    qui efface ses traces en base laisse la ligne dans le flux de logs.
 */

/** Clés dont la valeur est un secret quelle que soit sa forme — jamais restituées. */
const SECRET_KEY_PATTERN = /pass|secret|token|credential|authorization|api_?key|scriptkey|private/i;

/** Clés qui portent une URL : pour un webhook Discord ou Slack, le chemin est le secret. */
const URL_KEY_PATTERN = /url|webhook|href|endpoint|callback/i;

/** Profondeur, longueur de liste et longueur de chaîne au-delà desquelles on résume. */
const MAX_DEPTH = 4;
const MAX_ITEMS = 50;
const MAX_STRING = 256;

const REDACTED = '[Redacted]';

/** Ne garde d'une URL que son origine : le chemin et la requête portent les jetons. */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return REDACTED;
    const hasDetail = (url.pathname !== '' && url.pathname !== '/') || url.search !== '';
    return hasDetail ? `${url.origin}/…` : url.origin;
  } catch {
    // Pas une URL : c'est un nom de réglage (`slack_webhook_url`), pas une cible.
    return raw.length > MAX_STRING ? `${raw.slice(0, MAX_STRING)}…` : raw;
  }
}

/**
 * Rend un `metadata` restituable : secrets remplacés, URL réduites à leur origine, listes
 * et chaînes bornées. Rédiger plutôt qu'omettre — une purge de trois cents médias doit
 * pouvoir se relire, mais pas au prix d'une URL de webhook exfiltrée par l'écran d'audit.
 */
export function redactAuditMetadata(value: unknown, depth = 0, urlKey = false): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (urlKey) return redactUrl(value);
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return REDACTED;
    const kept = value.slice(0, MAX_ITEMS).map((item) => redactAuditMetadata(item, depth + 1, urlKey));
    return value.length > MAX_ITEMS ? [...kept, `… +${value.length - MAX_ITEMS}`] : kept;
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return REDACTED;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactAuditMetadata(item, depth + 1, URL_KEY_PATTERN.test(key));
    }
    return out;
  }
  // `undefined`, fonction, symbole : rien de tout cela ne survit à un aller-retour JSON.
  return undefined;
}

/**
 * Durée de conservation minimale du journal d'audit, en jours.
 *
 * Sans plancher, `PUT /api/admin/retention {"auditLog": 1}` suivi de
 * `POST /api/admin/retention/run` efface en deux gestes les traces de celui qui les fait.
 * `0` (conservation illimitée) reste évidemment permis ; toute durée finie vaut au moins
 * ce plancher. Câblé par `lib/retention.ts` : schéma de la politique **et** assainissement
 * de la valeur relue, une durée sous le plancher étant refusée plutôt qu'ajustée en silence.
 */
export const AUDIT_RETENTION_MIN_DAYS = 90;

/**
 * Actions que le balayage de rétention ne doit jamais emporter : ce sont précisément
 * celles qui décrivent un effacement. Les laisser expirer avec le reste revient à offrir
 * l'effacement de la preuve de l'effacement.
 */
export const AUDIT_UNPURGEABLE_ACTIONS = ['RETENTION_CONFIG', 'RETENTION_RUN', 'RETENTION_SWEEP'];

/**
 * Filtre des lignes d'audit réellement purgeables — utilisé par la famille `auditLog` du
 * balayage (`lib/retention.ts`) à la place du `{ createdAt: { lt: cutoff } }` d'origine.
 */
export function purgeableAuditWhere(cutoff: Date): Prisma.AuditLogWhereInput {
  return { createdAt: { lt: cutoff }, action: { notIn: AUDIT_UNPURGEABLE_ACTIONS } };
}

/**
 * Journal d'audit paginé enrichi de l'auteur (avatar/initiales) — flux d'activité admin
 * (Phase 21). L'utilisateur est présigné pour l'avatar ; `null` si l'auteur a été supprimé.
 * `metadata` est rendu sous sa forme rédigée (route réservée à ADMIN, cf. studio.routes).
 */
export async function list(p: PaginationParams): Promise<Paginated<unknown>> {
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      ...pageArgs(p),
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            username: true,
            avatarKey: true,
          },
        },
      },
    }),
    prisma.auditLog.count(),
  ]);
  const items = await Promise.all(
    rows.map(async ({ user, userId, metadata, ...row }) => ({
      ...row,
      metadata: redactAuditMetadata(metadata) ?? null,
      user: user
        ? {
            id: user.id,
            displayName: displayName(user),
            initials: initials(user),
            avatarUrl: await avatarUrl(user.avatarKey),
          }
        : null,
    })),
  );
  return paginate(items, total, p);
}

/**
 * Journalise une action sensible dans l'audit log (tolérant aux erreurs).
 *
 * L'entrée part *aussi* sur le journal pino, hors de portée de l'API : c'est la copie
 * qu'une politique de rétention hostile ne peut pas effacer (cf. en-tête de fichier).
 * La copie est rédigée comme la lecture — un fichier de log n'a pas plus vocation qu'un
 * écran à contenir le jeton d'un webhook.
 */
export function logAudit(params: {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
}): void {
  const metadata = (params.metadata ?? {}) as Prisma.InputJsonObject;
  logger.info(
    {
      audit: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        metadata: redactAuditMetadata(params.metadata ?? {}),
      },
    },
    '[audit]',
  );
  void prisma.auditLog
    .create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        metadata,
      },
    })
    .catch((err) => logger.warn({ err }, '[Audit] échec'));
}

/**
 * Trace d'une tentative de connexion par mot de passe (A5-03).
 *
 * Elle vit ici, et non dans la route, pour deux raisons. D'abord parce que `auth.routes`
 * est au budget de 200 lignes et que la logique n'a rien à y faire. Ensuite parce que la
 * propriété à tenir est délicate : le login ne doit rien laisser fuir de l'existence de
 * l'adresse. D'où une signature qui impose **le même travail dans les deux branches** —
 * un seul appel, les mêmes champs, seul le verdict change — et un `logAudit` qui détache
 * l'écriture en base : aucun écart de temps observable ne s'ajoute au chemin d'authentification.
 *
 * Le mot de passe n'est pas un paramètre : il ne peut donc pas être journalisé par
 * inadvertance, indépendamment de la rédaction de `redactAuditMetadata`.
 */
export function logLoginAttempt(params: {
  user: { id: number; totpEnabledAt?: Date | null } | null;
  granted: boolean;
  email: string;
  ip?: string;
}): void {
  // Un compte à second facteur n'a, à ce stade, que son mot de passe validé : sans ce
  // drapeau, `LOGIN` se lirait « session ouverte » alors que le TOTP peut encore échouer
  // (la suite s'écrit `TWOFA_FAIL` ou `TWOFA_BACKUP_USED`, cf. auth-2fa.routes).
  const pending2fa = params.granted && Boolean(params.user?.totpEnabledAt);
  logAudit({
    userId: params.user?.id ?? null,
    action: params.granted ? 'LOGIN' : 'LOGIN_FAIL',
    entityType: 'User',
    entityId: params.user?.id,
    metadata: { email: params.email, ip: params.ip ?? null, ...(pending2fa && { pending2fa }) },
  });
}
