// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Project, Role } from '../../types/api';
import { intlLocale, type MessageKey, type Tr } from '../../i18n';

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
export interface SettingField {
  key: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
  /** Champ exprimé en taille (Mo/Go) — saisie convertie en octets à l'enregistrement. */
  bytes?: boolean;
}
export const SETTINGS_FIELDS: SettingField[] = [
  { key: 'default_start_frame', labelKey: 'settings.defaultStartFrame', hintKey: 'settings.hint.startFrame' },
  {
    key: 'max_file_size',
    labelKey: 'settings.maxFileSize',
    hintKey: 'settings.hint.maxFileSize',
    bytes: true,
  },
  {
    key: 'storage_limit_user',
    labelKey: 'settings.storageQuota',
    hintKey: 'settings.hint.storageQuota',
    bytes: true,
  },
  { key: 'max_concurrent_uploads', labelKey: 'settings.maxUploads', hintKey: 'settings.hint.maxUploads' },
  { key: 'trash_retention_days', labelKey: 'settings.trashRetention', hintKey: 'settings.hint.trash' },
  // Salle de review live (33.B) : diffusions/seconde du pilote, par type de média (1–30).
  { key: 'live_sync_hz_video', labelKey: 'settings.liveVideo', hintKey: 'settings.hint.liveVideo' },
  { key: 'live_sync_hz_image', labelKey: 'settings.liveImage', hintKey: 'settings.hint.liveImage' },
  { key: 'live_sync_hz_3d', labelKey: 'settings.live3d', hintKey: 'settings.hint.liveCam' },
  { key: 'live_sync_hz_splat', labelKey: 'settings.liveSplat', hintKey: 'settings.hint.liveCamFocal' },
  { key: 'slack_webhook_url', labelKey: 'settings.slackWebhook', hintKey: 'settings.hint.slack' },
  // AGPL §13 : l'instance doit offrir SES sources. Vide = dépôt amont.
  { key: 'studio_source_url', labelKey: 'settings.sourceUrl', hintKey: 'settings.hint.sourceUrl' },
];

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
  return d > 0 ? `${d}j ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
};
