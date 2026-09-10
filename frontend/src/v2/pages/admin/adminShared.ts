// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Project, Role } from '../../types/api';
import { intlLocale, t, type Tr } from '../../i18n';

/** Types et helpers partagés par les sections de l'administration (10.C6). */
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

/** Libellé lisible d'une action d'audit (`PROJECT_DELETE` → « Projet supprimé »). */
export function auditActionLabel(action: string, t: Tr): string {
  const parts = action.split('_');
  const verb = parts[parts.length - 1];
  const subject = parts.slice(0, -1).join(' ');
  const verbs: Record<string, string> = {
    CREATE: t('audit.create'),
    UPDATE: t('audit.update'),
    DELETE: t('audit.delete'),
    PURGE: t('audit.purge'),
    RESTORE: t('audit.restore'),
    PUBLISH: t('audit.publish'),
    VERIFY: t('audit.verify'),
    LOGIN: t('audit.login'),
  };
  const subj = subject ? subject.charAt(0) + subject.slice(1).toLowerCase().replace(/_/g, ' ') : action;
  return `${subj} ${verbs[verb ?? ''] ?? (verb ?? '').toLowerCase()}`.trim();
}

/** Lien de navigation vers l'entité concernée par une entrée d'audit (ou `null`). */
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

export type SizeUnit = 'Mo' | 'Go';

const UNIT_MULT: Record<SizeUnit, number> = { Mo: 1e6, Go: 1e9 };

/** Convertit une saisie (nombre en Mo/Go, décimale `.` ou `,`) en octets. `null` si invalide. */
export function parseSizeToBytes(value: string, unit: SizeUnit): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * UNIT_MULT[unit]);
}

/** Octets → { value, unit } éditable : Go dès 1 Go, sinon Mo (2 décimales, sans zéros inutiles). */
export function bytesToUnit(bytes: number): { value: string; unit: SizeUnit } {
  const unit: SizeUnit = bytes >= 1e9 ? 'Go' : 'Mo';
  const v = bytes / UNIT_MULT[unit];
  return { value: String(Number(v.toFixed(2))), unit };
}
export const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST', 'CLIENT'];

export const fmtBytes = (b: number) =>
  b >= 1e9
    ? (b / 1e9).toFixed(2) + ' Go'
    : b >= 1e6
      ? (b / 1e6).toFixed(1) + ' Mo'
      : (b / 1e3).toFixed(0) + ' Ko';
/** Date+heure courtes localisées (listes denses de l'admin). */
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
