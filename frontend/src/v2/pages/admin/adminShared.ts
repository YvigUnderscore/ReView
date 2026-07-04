import type { Project, Role } from '../../types/api';

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
export interface ActivityData {
  days: number;
  uploads: { day: string; count: number; bytes: number }[];
  signups: { day: string; count: number }[];
}
export interface AuditRow {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  createdAt: string;
}
export type TrashProject = Pick<Project, 'id' | 'name' | 'status'> & { deletedAt: string };

export const SETTINGS_FIELDS: { key: string; label: string; hint: string }[] = [
  {
    key: 'default_start_frame',
    label: 'Frame de départ par défaut',
    hint: 'ex. 1001 — appliqué aux nouveaux projets',
  },
  { key: 'max_file_size', label: 'Taille max fichier (octets)', hint: 'ex. 5368709120 = 5 Go' },
  {
    key: 'storage_limit_user',
    label: 'Quota stockage / utilisateur (octets)',
    hint: 'ex. 10737418240 = 10 Go',
  },
  { key: 'max_concurrent_uploads', label: 'Uploads simultanés max', hint: 'ex. 5' },
  {
    key: 'trash_retention_days',
    label: 'Rétention corbeille (jours)',
    hint: 'ex. 30 — 0 = purge auto désactivée',
  },
];
export const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST', 'CLIENT'];

export const fmtBytes = (b: number) =>
  b >= 1e9
    ? (b / 1e9).toFixed(2) + ' Go'
    : b >= 1e6
      ? (b / 1e6).toFixed(1) + ' Mo'
      : (b / 1e3).toFixed(0) + ' Ko';
export const fmtDuration = (s: number) => {
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}j ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
};
export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
