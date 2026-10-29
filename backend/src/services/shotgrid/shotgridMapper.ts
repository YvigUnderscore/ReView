// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType, TaskStatus, TaskType } from '@prisma/client';

/**
 * ShotGrid <-> ReView conversions: pure functions, with no network or database access.
 * Everything that interprets a ShotGrid value lives here so that it is testable in isolation:
 * ShotGrid's formats hold enough surprises (colours in decimal RGB, durations in working minutes)
 * not to scatter them across the services.
 */

/** ShotGrid entity as the REST API returns it, flattened by the client. */
export interface SgRecord {
  id: number;
  type: string;
  [field: string]: unknown;
}

/** ShotGrid entity reference (`entity`, `project`, `sg_sequence` field...). */
export interface SgEntityRef {
  id: number;
  type: string;
  name?: string;
}

export function asEntityRef(value: unknown): SgEntityRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'number' || typeof v.type !== 'string') return null;
  return { id: v.id, type: v.type, name: typeof v.name === 'string' ? v.name : undefined };
}

export function asEntityRefs(value: unknown): SgEntityRef[] {
  if (!Array.isArray(value)) return [];
  return value.map(asEntityRef).filter((r): r is SgEntityRef => r !== null);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** ShotGrid date (`YYYY-MM-DD` or full ISO) -> Date, `null` if absent or unreadable. */
export function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date -> `YYYY-MM-DD`, the format ShotGrid expects for start_date / due_date. */
export function toSgDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Colour of a ShotGrid status: `bg_color` holds "202,225,202" (decimal RGB), not hex.
 * An absent or unreadable value falls back to a neutral grey rather than failing —
 * a status without a colour remains a usable status.
 */
export function rgbToHex(raw: unknown, fallback = '#6B7280'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  const parts = trimmed.split(',').map((p) => Number.parseInt(p.trim(), 10));
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return fallback;
  return `#${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * ShotGrid status -> ReView's frozen enum (the kanban and the historical statistics rely on it). The match is made on the code: ShotGrid's codes are
 * stable from one site to another for the standard values, and an unknown code falls back to TODO rather than failing the import.
 */
const SG_STATUS_TO_ENUM: Record<string, TaskStatus> = {
  wtg: TaskStatus.TODO, // Waiting to Start
  rdy: TaskStatus.TODO, // Ready to Start
  na: TaskStatus.TODO,
  hld: TaskStatus.TODO, // On Hold
  ip: TaskStatus.IN_PROGRESS, // In Progress
  act: TaskStatus.IN_PROGRESS, // Active
  rev: TaskStatus.PENDING_REVIEW, // Pending Review
  pnd: TaskStatus.PENDING_REVIEW,
  vwd: TaskStatus.PENDING_REVIEW, // Viewed
  apr: TaskStatus.APPROVED, // Approved
  fin: TaskStatus.APPROVED, // Final
  cmpt: TaskStatus.APPROVED, // Complete
  cbb: TaskStatus.RETAKE, // Cbb / to redo
  rrq: TaskStatus.RETAKE, // Revision requested
  rtk: TaskStatus.RETAKE, // Retake — most widespread code, absent from the "standard" lists
  rej: TaskStatus.REJECTED,
  pass: TaskStatus.APPROVED, // reviewed without reservation
  suprev: TaskStatus.PENDING_REVIEW, // en attente de supervision
  ign: TaskStatus.TODO,
  omt: TaskStatus.REJECTED, // Omit
  dcl: TaskStatus.REJECTED, // Declined
};

export function sgStatusToEnum(code: string | null | undefined): TaskStatus {
  if (!code) return TaskStatus.TODO;
  return SG_STATUS_TO_ENUM[code.toLowerCase()] ?? TaskStatus.TODO;
}

/** Does a ShotGrid status mark the end of the work? (gauges, statistics) */
export function sgStatusIsDone(code: string | null | undefined): boolean {
  const mapped = sgStatusToEnum(code);
  return mapped === TaskStatus.APPROVED;
}

/**
 * Status that represents neither work to do nor work done.
 *
 * A shot that is omitted, not applicable or deactivated waits for no one: counting it as remaining work inflates a production's progress gauges indefinitely, and
 * announcing it as finished would flatter it. These statuses are displayed, but do not count.
 */
export function sgStatusIsInactive(code: string | null | undefined): boolean {
  return ['omt', 'dis', 'ign', 'na', 'dcl'].includes((code ?? '').toLowerCase());
}

/** Does a Version status mean approval? (feeds `ReviewStatus.isApproval`) */
export function sgStatusIsApproval(code: string | null | undefined): boolean {
  return ['apr', 'fin', 'cmpt', 'cfrm'].includes((code ?? '').toLowerCase());
}

export function sgStatusIsRetake(code: string | null | undefined): boolean {
  return ['cbb', 'rrq', 'rej', 'dcl'].includes((code ?? '').toLowerCase());
}

/**
 * ShotGrid asset type (free list per site) -> ReView enum.
 * The site's exact label is kept separately (`ShotgridLink.data.sgAssetType`): the enum serves the filters, not to restore the studio's vocabulary.
 */
export function sgAssetType(raw: unknown): AssetType {
  const v = (asString(raw) ?? '').toLowerCase();
  if (v.includes('char')) return AssetType.CHARACTER;
  if (v.includes('prop')) return AssetType.PROP;
  if (v.includes('env') || v.includes('set') || v.includes('location')) return AssetType.ENVIRONMENT;
  if (v.includes('vehic')) return AssetType.VEHICLE;
  if (v.includes('fx') || v.includes('effect')) return AssetType.FX;
  return AssetType.OTHER;
}

/** ShotGrid Pipeline Step -> ReView task type (the exact step goes into `department`). */
export function sgStepToTaskType(step: string | null | undefined): TaskType {
  const v = (step ?? '').toLowerCase();
  if (v.includes('model')) return TaskType.MODELING;
  if (v.includes('rig')) return TaskType.RIGGING;
  if (v.includes('anim')) return TaskType.ANIMATION;
  if (v.includes('fx') || v.includes('effect')) return TaskType.FX;
  if (v.includes('light')) return TaskType.LIGHTING;
  if (v.includes('comp')) return TaskType.COMPOSITING;
  if (v.includes('look') || v.includes('shad') || v.includes('textur')) return TaskType.LOOKDEV;
  if (v.includes('layout') || v.includes('block')) return TaskType.LAYOUT;
  return TaskType.OTHER;
}

/**
 * ShotGrid duration -> working days. `duration` is expressed in working minutes (2400 = 5 days of 8 h):
 * displaying it as is would give absurd numbers.
 */
export function minutesToWorkdays(minutes: number | null | undefined, hoursPerDay = 8): number | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round((minutes / (hoursPerDay * 60)) * 100) / 100;
}

export function workdaysToMinutes(days: number | null | undefined, hoursPerDay = 8): number | null {
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return null;
  return Math.round(days * hoursPerDay * 60);
}

/** Duration of a shot in frames, from the cut bounds (inclusive at both ends). */
export function cutDuration(cutIn: number | null, cutOut: number | null): number | null {
  if (cutIn === null || cutOut === null || cutOut < cutIn) return null;
  return cutOut - cutIn + 1;
}

/** Readable code of a ShotGrid entity (`code` on most, `content` on Task). */
export function sgDisplayName(record: SgRecord): string {
  return (
    asString(record.code) ??
    asString(record.content) ??
    asString(record.name) ??
    `${record.type} ${record.id}`
  );
}

/** "media" field of a Version: a usable URL depending on the requested source. */
export function pickVersionMediaField(
  record: SgRecord,
  source: 'transcoded' | 'original',
): { field: string; value: unknown } | null {
  const order =
    source === 'original'
      ? ['sg_uploaded_movie', 'sg_uploaded_movie_mp4', 'sg_uploaded_movie_webm']
      : ['sg_uploaded_movie_mp4', 'sg_uploaded_movie_webm', 'sg_uploaded_movie'];
  for (const field of order) {
    const value = record[field];
    if (value && typeof value === 'object') return { field, value };
  }
  return null;
}

/**
 * Direct address carried by a file field.
 *
 * ShotGrid often places the URL in the field itself, next to the name: when the dedicated download endpoint does not answer, this is a usable fallback as is.
 */
export function attachmentUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const url = asString(v.url);
  if (url) return url;
    // Some fields nest the attachment (`{ attachment: { url } }`).
  const nested = v.attachment;
  return nested && typeof nested === 'object' ? asString((nested as Record<string, unknown>).url) : null;
}

/**
 * Identifier of the `Attachment` carried by a file field.
 *
 * ShotGrid describes a file field by the `Attachment` entity that stores it: `{ id, type: 'Attachment', name, url, link_type }`. It is THAT identifier which designates
 * the file — not the one of the Version exposing it. Confusing them produced a match whose type and identifier spoke of two different entities.
 *
 * Some fields nest the attachment (`{ attachment: { id, type } }`), and some sites return only a URL with no identifier: in that last case we return nothing
 * rather than make up a number.
 */
export function attachmentId(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const direct = asEntityRef(v);
  if (direct?.type === 'Attachment') return direct.id;
  const nested = asEntityRef(v.attachment);
  return nested?.type === 'Attachment' ? nested.id : null;
}

/** File name of a ShotGrid attachment, or a stable fallback. */
export function attachmentName(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return asString(v.name) ?? asString(v.link_type) ?? fallback;
  }
  return fallback;
}

/**
 * Local name of an entity whose code is already carried by another entity of the site.
 *
 * A site easily hosts four sequences named "DO_NOT_USE_": the local uniqueness constraint, for its part, accepts only one. The suffix is the ShotGrid identifier,
 * hence stable: re-synchronizing falls back on the same name, without ever piling up suffixes or manufacturing one duplicate more.
 */
export function disambiguatedName(name: string, sgId: number): string {
  return `${name} (${sgId})`;
}

/** The site's name behind a local name that may have been disambiguated. */
export function plainName(name: string | null | undefined, sgId: number): string | null {
  if (!name) return null;
  const suffix = ` (${sgId})`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
