// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Project, Role } from '../../types/api';
import { intlLocale, t, type Tr } from '../../i18n';

/** Types and helpers shared by the administration sections (10.C6). */
export interface Stats {
  users: { total: number; byRole: Record<string, number>; online: number };
  pipeline: { projects: number; sequences: number; shots: number; assets: number; versions: number };
  media: {
    count: number;
    byKind: Record<string, number>;
    byStatus: Record<string, number>;
    storageBytes: number;
  };
  comments: number;
  jobs: Record<string, number> | null;
  topStorageUsers: { id: number; name: string; storageUsed: number; storageLimit: number | null }[];
}
export interface System {
  host: {
    platform: string;
    arch: string;
    nodeVersion: string;
    cpus: number;
    loadAvg: number[];
    uptimeSec: number;
    processUptimeSec: number;
  };
  memory: { total: number; free: number; used: number; processRss: number };
  disk: { total: number; free: number } | null;
  services: { database: boolean; redis: boolean; minio: boolean };
}
export interface AuditUser {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}
export interface AuditRow {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  createdAt: string;
  user?: AuditUser | null;
}

/** Human-readable label for an audit action (`PROJECT_DELETE` → "Project deleted"). */
/**
 * Actions that the `SUBJECT_VERB` split does not account for: their label is written out in
 * full. **Functions** taking `t`, never a string table: a module-level table would freeze the
 * language at file load.
 */
const AUDIT_EXPLICIT: Record<string, (t: Tr) => string> = {
  VERSION_DECISION: (t) => t('audit.versionDecision'),
  VERSION_DECISION_BULK: (t) => t('audit.versionDecisionBulk'),
};

/**
 * Human-readable label for an audit log action.
 *
 * Decoding relies on the `SUBJECT_VERB` convention in SCREAMING_SNAKE. Two
 * recent actions were written in dotted notation (`version.decision`): without underscores, the
 * subject came out empty, the verb was not found, **and the raw key was printed
 * twice**: the screen showed "version.decision.bulk version.decision.bulk". The source is
 * fixed server-side; the two guards below ensure this failure mode can no longer
 * occur, including on rows already written in the database.
 */
export function auditActionLabel(action: string, t: Tr): string {
  const explicit = AUDIT_EXPLICIT[action] ?? AUDIT_EXPLICIT[normalizeAuditAction(action)];
  if (explicit) return explicit(t);
  const parts = action.split('_');
  const verbs: Record<string, string> = {
    CREATE: t('audit.create'),
    UPDATE: t('audit.update'),
    DELETE: t('audit.delete'),
    PURGE: t('audit.purge'),
    RESTORE: t('audit.restore'),
    PUBLISH: t('audit.publish'),
    VERIFY: t('audit.verify'),
    LOGIN: t('audit.login'),
    ADD: t('audit.add'),
    ENABLE: t('audit.enable'),
    DISABLE: t('audit.disable'),
    REVOKE: t('audit.revoke'),
    VIEW: t('audit.view'),
    FAIL: t('audit.fail'),
    MOVE: t('audit.move'),
  };
  // One-piece action: there is no subject or verb to extract from it. Rendering it as is
  // ONCE is better than concatenating it with itself.
  if (parts.length < 2) return action;
  const verb = parts[parts.length - 1];
  const subject = parts.slice(0, -1).join(' ');
  const subj = subject.charAt(0) + subject.slice(1).toLowerCase().replace(/_/g, ' ');
  return `${subj} ${verbs[verb] ?? verb.toLowerCase()}`.trim();
}

/**
 * Brings an action in dotted notation back to the log convention.
 *
 * Rows already written to the database carry `version.decision`: they must remain readable
 * after the source is fixed, without a mandatory migration.
 */
export function normalizeAuditAction(action: string): string {
  return action.includes('.') ? action.replace(/\./g, '_').toUpperCase() : action;
}

/**
 * Label of a version status (`VersionStatus`).
 *
 * The "Publication" column rendered the **raw** Prisma enum: `DRAFT` and `REVIEW` badges
 * in capitals next to a lowercase `published`, and English in all fourteen
 * languages. A function, never a module table: a table would freeze the language at
 * file load (i18n rule no. 5).
 */
export function versionStatusLabel(status: string, t: Tr): string {
  switch (status) {
    case 'DRAFT':
      return t('version.status.draft');
    case 'REVIEW':
      return t('version.status.review');
    case 'PUBLISHED':
      return t('version.status.published');
    default:
      // A status added to the schema without going through here: readable rather than shouting.
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
}

/** Navigation link to the entity concerned by an audit entry (or `null`). */
export function auditEntityLink(entityType: string | null, entityId: number | null): string | null {
  if (!entityType || !entityId) return null;
  const routes: Record<string, string> = {
    Project: `/projects/${entityId}`,
    Asset: `/assets/${entityId}`,
    Task: `/tasks/${entityId}`,
    MediaObject: `/review/${entityId}`,
  };
  return routes[entityType] ?? null;
}
export type TrashProject = Pick<Project, 'id' | 'name' | 'status'> & { deletedAt: string };

/**
 * Size input unit in administration.
 *
 * The symbols were written `'Mo' | 'Go'`: the selector showed French to a Japanese
 * reader, and the "New user" modal said "Quota (GB)" two screens later. The base was decimal
 * (1e6/1e9) where `formatBytes` counts in 1024: we entered "1 Go" and the screen next door
 * reread "0.93 Go" for the same value.
 */
export type SizeUnit = 'MB' | 'GB';

const UNIT_MULT: Record<SizeUnit, number> = { MB: 1024 ** 2, GB: 1024 ** 3 };

/** Converts an input (number in MB/GB, decimal `.` or `,`) to bytes. `null` if invalid. */
export function parseSizeToBytes(value: string, unit: SizeUnit): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * UNIT_MULT[unit]);
}

/** Bytes → editable { value, unit }: GB from 1 GiB, otherwise MB (2 decimals, no useless zeros). */
export function bytesToUnit(bytes: number): { value: string; unit: SizeUnit } {
  const unit: SizeUnit = bytes >= UNIT_MULT.GB ? 'GB' : 'MB';
  const v = bytes / UNIT_MULT[unit];
  return { value: String(Number(v.toFixed(2))), unit };
}
export const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST', 'CLIENT'];

/**
 * File size: re-exported from `lib/formatBytes`, which renders it in the reader's
 * language via `Intl.NumberFormat`.
 *
 * The implementation that lived here wrote "Ko", "Mo" and "Go" **hard-coded, in French**,
 * in the seven admin screens that use it, including with the interface in
 * English. It also counted in base 1000 where `formatBytes` counts in 1024: two
 * screens gave two different sizes for the same file. The header comment of
 * `lib/formatBytes` announced this replacement; it had never been done.
 */
export { formatBytes as fmtBytes } from '../../../lib/formatBytes';
/** Short localized date+time (dense admin lists). */
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(intlLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export const fmtDuration = (s: number) => {
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  return d > 0
    ? `${d}${t('common.dayShort')} ${h}${t('common.hourShort')}`
    : h > 0
      ? `${h}${t('common.hourShort')} ${m}${t('common.minShort')}`
      : `${m}${t('common.minShort')}`;
};
