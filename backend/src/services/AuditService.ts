// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { displayName, initials, avatarUrl } from '../lib/userView';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';

/**
 * Audit log (Phase 21): writing (`logAudit`) and paginated reading (`list`).
 *
 * Two properties are upheld here, because a log lacking them is useless on the day it is consulted:
 *
 * 1. **The `metadata` is returned.** It was dropped from the response: the audit screen showed
 *    "MEDIA_PURGE · MediaObject · 812" without saying which of the three hundred identifiers in the batch
 *    had gone. It is now returned, but *redacted* (see `redactAuditMetadata`), because it contains both
 *    harmless identifiers and webhook URLs whose path IS the secret.
 * 2. **The trace leaves the API's reach.** Each entry is also emitted to the pino log, which the retention
 *    policy cannot purge: an administrator who erases their traces in the database leaves the line in the
 *    log stream.
 */

/** Keys whose value is a secret whatever its form: never returned. */
const SECRET_KEY_PATTERN = /pass|secret|token|credential|authorization|api_?key|scriptkey|private/i;

/** Keys carrying a URL: for a Discord or Slack webhook, the path is the secret. */
const URL_KEY_PATTERN = /url|webhook|href|endpoint|callback/i;

/** Depth, list length and string length beyond which values are summarized. */
const MAX_DEPTH = 4;
const MAX_ITEMS = 50;
const MAX_STRING = 256;

const REDACTED = '[Redacted]';

/** Keeps only the origin of a URL: the path and query carry the tokens. */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return REDACTED;
    const hasDetail = (url.pathname !== '' && url.pathname !== '/') || url.search !== '';
    return hasDetail ? `${url.origin}/…` : url.origin;
  } catch {
    // Not a URL: it is a setting name (`slack_webhook_url`), not a target.
    return raw.length > MAX_STRING ? `${raw.slice(0, MAX_STRING)}…` : raw;
  }
}

/**
 * Makes `metadata` returnable: secrets replaced, URLs reduced to their origin, lists and strings bounded.
 * Redact rather than omit: a purge of three hundred media must remain readable, but not at the cost of a
 * webhook URL leaked through the audit screen.
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
  // `undefined`, functions, symbols: none of these survive a JSON round trip.
  return undefined;
}

/**
 * Minimum retention period of the audit log, in days.
 *
 * Without a floor, `PUT /api/admin/retention {"auditLog": 1}` followed by `POST /api/admin/retention/run`
 * erases, in two moves, the traces of whoever did it. `0` (unlimited retention) obviously remains allowed;
 * any finite duration is at least this floor. Wired by `lib/retention.ts`: both the policy schema **and**
 * the sanitizing of the value read back, a duration below the floor being refused rather than silently
 * adjusted.
 */
export const AUDIT_RETENTION_MIN_DAYS = 90;

/**
 * Actions the retention sweep must never carry away: these are precisely the ones describing an erasure.
 * Letting them expire with the rest would amount to offering the erasure of the proof of erasure.
 */
export const AUDIT_UNPURGEABLE_ACTIONS = ['RETENTION_CONFIG', 'RETENTION_RUN', 'RETENTION_SWEEP'];

/**
 * Filter of the audit rows that can actually be purged: used by the `auditLog` family of the sweep
 * (`lib/retention.ts`) in place of the original `{ createdAt: { lt: cutoff } }`.
 */
export function purgeableAuditWhere(cutoff: Date): Prisma.AuditLogWhereInput {
  return { createdAt: { lt: cutoff }, action: { notIn: AUDIT_UNPURGEABLE_ACTIONS } };
}

/**
 * Paginated audit log enriched with the author (avatar/initials): admin activity feed (Phase 21). The user is
 * presigned for the avatar; `null` if the author has been deleted. `metadata` is returned in its redacted
 * form (route reserved to ADMIN, see studio.routes).
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
 * Logs a sensitive action in the audit log (tolerant of errors).
 *
 * The entry ALSO goes to the pino log, out of the API's reach: this is the copy that a hostile retention
 * policy cannot erase (see the file header). The copy is redacted like the reading: a log file has no more
 * right than a screen to contain a webhook token.
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
 * Records a password login attempt (A5-03).
 *
 * It lives here rather than in the route for two reasons. First, `auth.routes` is held to a budget of 200
 * lines and the logic has no business there. Second, the property to uphold is delicate: login must leak
 * nothing about whether the address exists. Hence a signature that requires **the same work in both
 * branches**: one call, the same fields, only the verdict changes, and a `logAudit` that detaches the
 * database write, so that no observable timing difference is added to the authentication path.
 *
 * The password is not a parameter: it therefore cannot be logged by mistake, regardless of the redaction in
 * `redactAuditMetadata`.
 */
export function logLoginAttempt(params: {
  user: { id: number; totpEnabledAt?: Date | null } | null;
  granted: boolean;
  email: string;
  ip?: string;
}): void {
  // An account with a second factor only has its validated password at this stage: without this flag, `LOGIN`
  // would read as "session open" while the TOTP can still fail (the follow-up is written `TWOFA_FAIL` or
  // `TWOFA_BACKUP_USED`, see auth-2fa.routes).
  const pending2fa = params.granted && Boolean(params.user?.totpEnabledAt);
  logAudit({
    userId: params.user?.id ?? null,
    action: params.granted ? 'LOGIN' : 'LOGIN_FAIL',
    entityType: 'User',
    entityId: params.user?.id,
    metadata: { email: params.email, ip: params.ip ?? null, ...(pending2fa && { pending2fa }) },
  });
}
