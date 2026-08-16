// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType, TaskStatus, TaskType } from '@prisma/client';

/**
 * Conversions ShotGrid ↔ ReView — fonctions pures, sans accès réseau ni base.
 * Tout ce qui interprète une valeur ShotGrid vit ici pour être testable isolément :
 * les formats de ShotGrid réservent assez de surprises (couleurs en RGB décimal,
 * durées en minutes ouvrées) pour ne pas les disperser dans les services.
 */

/** Entité ShotGrid telle que la renvoie l'API REST, aplatie par le client. */
export interface SgRecord {
  id: number;
  type: string;
  [field: string]: unknown;
}

/** Référence d'entité ShotGrid (champ `entity`, `project`, `sg_sequence`…). */
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

/** Date ShotGrid (`YYYY-MM-DD` ou ISO complet) → Date, `null` si absente/illisible. */
export function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → `YYYY-MM-DD`, le format qu'attend ShotGrid pour start_date / due_date. */
export function toSgDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Couleur d'un statut ShotGrid : `bg_color` vaut "202,225,202" (RGB décimal), pas du hex.
 * Une valeur absente ou illisible retombe sur un gris neutre plutôt que d'échouer —
 * un statut sans couleur reste un statut utilisable.
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
 * Statut ShotGrid → enum figé de ReView (le kanban et les statistiques historiques
 * s'appuient dessus). Le rapprochement se fait sur le code : ceux de ShotGrid sont
 * stables d'un site à l'autre pour les valeurs standard, et un code inconnu retombe
 * sur TODO plutôt que de faire échouer l'import.
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
  rtk: TaskStatus.RETAKE, // Retake — code le plus répandu, absent des listes « standard »
  rej: TaskStatus.REJECTED,
  pass: TaskStatus.APPROVED, // relu sans réserve
  suprev: TaskStatus.PENDING_REVIEW, // en attente de supervision
  ign: TaskStatus.TODO,
  omt: TaskStatus.REJECTED, // Omit
  dcl: TaskStatus.REJECTED, // Declined
};

export function sgStatusToEnum(code: string | null | undefined): TaskStatus {
  if (!code) return TaskStatus.TODO;
  return SG_STATUS_TO_ENUM[code.toLowerCase()] ?? TaskStatus.TODO;
}

/** Un statut ShotGrid marque-t-il la fin du travail ? (jauges, statistiques) */
export function sgStatusIsDone(code: string | null | undefined): boolean {
  const mapped = sgStatusToEnum(code);
  return mapped === TaskStatus.APPROVED;
}

/**
 * Statut qui ne représente ni du travail à faire, ni du travail fait.
 *
 * Un plan omis, sans objet ou désactivé n'attend rien de personne : le compter comme du
 * reste-à-faire gonfle indéfiniment les jauges d'avancement d'une production, et
 * l'annoncer comme terminé la flatterait. Ces statuts s'affichent, mais ne comptent pas.
 */
export function sgStatusIsInactive(code: string | null | undefined): boolean {
  return ['omt', 'dis', 'ign', 'na', 'dcl'].includes((code ?? '').toLowerCase());
}

/** Un statut de Version vaut-il approbation ? (alimente `ReviewStatus.isApproval`) */
export function sgStatusIsApproval(code: string | null | undefined): boolean {
  return ['apr', 'fin', 'cmpt', 'cfrm'].includes((code ?? '').toLowerCase());
}

export function sgStatusIsRetake(code: string | null | undefined): boolean {
  return ['cbb', 'rrq', 'rej', 'dcl'].includes((code ?? '').toLowerCase());
}

/**
 * Type d'asset ShotGrid (liste libre par site) → enum ReView.
 * Le libellé exact du site est conservé à part (`ShotgridLink.data.sgAssetType`) :
 * l'enum sert aux filtres, pas à restituer le vocabulaire du studio.
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

/** Pipeline Step ShotGrid → type de tâche ReView (l'étape exacte va dans `department`). */
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
 * Durée ShotGrid → jours ouvrés. `duration` est exprimée en minutes de travail
 * (2400 = 5 jours de 8 h) : l'afficher telle quelle donnerait des nombres absurdes.
 */
export function minutesToWorkdays(minutes: number | null | undefined, hoursPerDay = 8): number | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round((minutes / (hoursPerDay * 60)) * 100) / 100;
}

export function workdaysToMinutes(days: number | null | undefined, hoursPerDay = 8): number | null {
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return null;
  return Math.round(days * hoursPerDay * 60);
}

/** Durée d'un plan en images, à partir des bornes de cut (inclusives des deux côtés). */
export function cutDuration(cutIn: number | null, cutOut: number | null): number | null {
  if (cutIn === null || cutOut === null || cutOut < cutIn) return null;
  return cutOut - cutIn + 1;
}

/** Code lisible d'une entité ShotGrid (`code` sur la plupart, `content` sur Task). */
export function sgDisplayName(record: SgRecord): string {
  return (
    asString(record.code) ??
    asString(record.content) ??
    asString(record.name) ??
    `${record.type} ${record.id}`
  );
}

/** Champ « media » d'une Version : URL exploitable selon la source demandée. */
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
 * Adresse directe portée par un champ fichier.
 *
 * ShotGrid place souvent l'URL dans le champ lui-même, à côté du nom : quand
 * l'endpoint de téléchargement dédié ne répond pas, c'est un repli utilisable tel quel.
 */
export function attachmentUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const url = asString(v.url);
  if (url) return url;
  // Certains champs imbriquent l'attachment (`{ attachment: { url } }`).
  const nested = v.attachment;
  return nested && typeof nested === 'object' ? asString((nested as Record<string, unknown>).url) : null;
}

/** Nom de fichier d'un attachment ShotGrid, ou un repli stable. */
export function attachmentName(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return asString(v.name) ?? asString(v.link_type) ?? fallback;
  }
  return fallback;
}

/**
 * Nom local d'une entité dont le code est déjà porté par une autre entité du site.
 *
 * Un site héberge sans peine quatre séquences nommées « DO_NOT_USE_ » : la contrainte
 * d'unicité locale, elle, n'en accepte qu'une. Le suffixe est l'identifiant ShotGrid,
 * donc stable : re-synchroniser retombe sur le même nom, sans jamais empiler les
 * suffixes ni fabriquer un doublon de plus.
 */
export function disambiguatedName(name: string, sgId: number): string {
  return `${name} (${sgId})`;
}

/** Le nom du site derrière un nom local éventuellement désambiguïsé. */
export function plainName(name: string | null | undefined, sgId: number): string | null {
  if (!name) return null;
  const suffix = ` (${sgId})`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
