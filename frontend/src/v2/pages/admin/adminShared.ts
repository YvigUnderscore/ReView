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
/**
 * Actions dont le découpage `SUJET_VERBE` ne rend pas compte : leur libellé est écrit en
 * toutes lettres. Des **fonctions** prenant `t`, jamais une table de chaînes — une table de
 * module figerait la langue au chargement du fichier.
 */
const AUDIT_EXPLICIT: Record<string, (t: Tr) => string> = {
  VERSION_DECISION: (t) => t('audit.versionDecision'),
  VERSION_DECISION_BULK: (t) => t('audit.versionDecisionBulk'),
};

/**
 * Libellé lisible d'une action du journal d'audit.
 *
 * Le décodage repose sur la convention `SUJET_VERBE` en SCREAMING_SNAKE. Deux actions
 * récentes étaient écrites en notation pointée (`version.decision`) : sans underscore, le
 * sujet ressortait vide, le verbe restait introuvable, **et la clé brute était imprimée deux
 * fois** — l'écran affichait « version.decision.bulk version.decision.bulk ». La source est
 * corrigée côté serveur ; les deux gardes ci-dessous font que ce mode d'échec ne peut plus se
 * reproduire, y compris sur les lignes déjà écrites en base.
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
  // Action en un seul morceau : il n'y a ni sujet ni verbe à en tirer. La rendre telle quelle
  // UNE fois vaut mieux que de la concaténer avec elle-même.
  if (parts.length < 2) return action;
  const verb = parts[parts.length - 1];
  const subject = parts.slice(0, -1).join(' ');
  const subj = subject.charAt(0) + subject.slice(1).toLowerCase().replace(/_/g, ' ');
  return `${subj} ${verbs[verb] ?? verb.toLowerCase()}`.trim();
}

/**
 * Ramène une action en notation pointée à la convention du journal.
 *
 * Les lignes déjà écrites en base portent `version.decision` : elles doivent rester lisibles
 * après correction de la source, sans migration obligatoire.
 */
export function normalizeAuditAction(action: string): string {
  return action.includes('.') ? action.replace(/\./g, '_').toUpperCase() : action;
}

/**
 * Libellé d'un statut de version (`VersionStatus`).
 *
 * La colonne « Publication » rendait l'enum Prisma **brut** — des badges `DRAFT` et `REVIEW`
 * en majuscules à côté d'un `published` en minuscules, et de l'anglais dans les quatorze
 * langues. Une fonction, jamais une table de module : une table figerait la langue au
 * chargement du fichier (règle i18n n° 5).
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
      // Un statut ajouté au schéma sans passer ici : lisible plutôt que criard.
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
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

/**
 * Unité de saisie des tailles en administration.
 *
 * Les symboles étaient écrits `'Mo' | 'Go'` : le sélecteur affichait du français à un
 * lecteur japonais, et la modale « New user » disait « Quota (GB) » deux écrans plus loin.
 * La base était décimale (1e6/1e9) là où `formatBytes` compte en 1024 — on saisissait « 1 Go »
 * et l'écran d'à côté relisait « 0,93 Go » sur la même valeur.
 */
export type SizeUnit = 'MB' | 'GB';

const UNIT_MULT: Record<SizeUnit, number> = { MB: 1024 ** 2, GB: 1024 ** 3 };

/** Convertit une saisie (nombre en MB/GB, décimale `.` ou `,`) en octets. `null` si invalide. */
export function parseSizeToBytes(value: string, unit: SizeUnit): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * UNIT_MULT[unit]);
}

/** Octets → { value, unit } éditable : GB dès 1 Gio, sinon MB (2 décimales, sans zéros inutiles). */
export function bytesToUnit(bytes: number): { value: string; unit: SizeUnit } {
  const unit: SizeUnit = bytes >= UNIT_MULT.GB ? 'GB' : 'MB';
  const v = bytes / UNIT_MULT[unit];
  return { value: String(Number(v.toFixed(2))), unit };
}
export const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST', 'CLIENT'];

/**
 * Taille de fichier — réexportée depuis `lib/formatBytes`, qui la rend dans la langue du
 * lecteur via `Intl.NumberFormat`.
 *
 * L'implémentation qui vivait ici écrivait « Ko », « Mo » et « Go » **en dur, en français**,
 * dans les sept écrans d'administration qui l'utilisent — y compris avec l'interface en
 * anglais. Elle comptait de surcroît en base 1000 quand `formatBytes` compte en 1024 : deux
 * écrans donnaient deux tailles différentes pour le même fichier. Le commentaire d'en-tête de
 * `lib/formatBytes` annonçait ce remplacement ; il n'avait jamais été fait.
 */
export { formatBytes as fmtBytes } from '../../../lib/formatBytes';
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
