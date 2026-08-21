// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommentAttachment } from '../../lib/commentAttachments';

/**
 * Types API partagés (10.E2) — une entité = une définition.
 * Miroir des réponses backend (backend/src/routes/* + prisma/schema.prisma) :
 * les variantes par endpoint se composent avec Pick/intersection, ici ou dans
 * la page concernée — jamais par re-déclaration d'interface.
 */

// ── Enums (miroir de backend/prisma/schema.prisma) ───────────────────────────
export type Role = 'ADMIN' | 'SUPERVISOR' | 'ARTIST' | 'CLIENT';
export type UserStatus = 'AVAILABLE' | 'AWAY' | 'DND';
export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export type AssetType = 'CHARACTER' | 'PROP' | 'ENVIRONMENT' | 'VEHICLE' | 'FX' | 'OTHER';
export type TaskType =
  'MODELING' | 'RIGGING' | 'ANIMATION' | 'FX' | 'LIGHTING' | 'COMPOSITING' | 'LOOKDEV' | 'LAYOUT' | 'OTHER';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RETAKE';
export type VersionStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED';
export type MediaKind = 'VIDEO' | 'IMAGE' | 'MODEL_3D' | 'SPLAT';
export type MediaStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
export type AnnouncementType = 'INFO' | 'WARNING' | 'MAINTENANCE';
export type AnnouncementFrequency = 'PERMANENT' | 'FIRST_LOGIN' | 'FIRST_OF_DAY';

// ── Annonces studio (Phase 22) ────────────────────────────────────────────────
export interface Announcement {
  id: number;
  title: string;
  body: string;
  type: AnnouncementType;
  frequency: AnnouncementFrequency;
  roles: Role[];
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
/** GET /api/announcements (admin) — avec nombre d'accusés de lecture. */
export type AnnouncementAdmin = Announcement & { _count: { reads: number } };

/** Palier de qualité HLS (contexte Vidéo). */
export interface TranscodeRendition {
  height: number;
  videoBitrateK: number;
}
/** GET /api/admin/transcode — config de transcodage vidéo (contexte Vidéo, Phase 22/23). */
export interface TranscodeConfig {
  enabled: boolean;
  crf: number;
  preset: string;
  audioBitrateK: number;
  maxHeight: number;
  ladder: TranscodeRendition[];
  /** Scene detection (34.H) : marqueurs « Plan n » posés aux coupes (opt-in). */
  sceneDetection?: boolean;
}

/** GET /api/studio/smtp — config SMTP (jamais le mot de passe). */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean;
  envOverride: boolean;
}

// ── Utilisateurs ──────────────────────────────────────────────────────────────
/** Ligne complète de GET /api/users (admin). */
export interface User {
  id: number;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  /** Profil enrichi (42.B — №89). */
  jobTitle?: string | null;
  bio?: string | null;
  phone?: string | null;
  displayName?: string;
  initials?: string;
  avatarUrl?: string | null;
  status?: UserStatus;
  role: Role;
  storageUsed: number;
  storageLimit: number | null;
  online?: boolean;
  /** Compte créé par invitation, lien encore valide et jamais utilisé (annuaire admin). */
  invitePending?: boolean;
}
/** Référence minimale (author de version, assignee de tâche). */
export type UserRef = Pick<User, 'id' | 'name'>;
/** Auteur affiché avec avatar (commentaires, documents). */
export type AuthorRef = Pick<User, 'id' | 'name' | 'displayName' | 'initials' | 'avatarUrl'>;

// Entités du pipe (Project, Sequence, Shot, Asset) — module séparé (budget de lignes).
export * from './entities';

// Tâches (Task, TaskWithAssignee, ChecklistItem, TaskDetail) — module séparé (budget de lignes).
export * from './task';

// USD & provenance de conversion 3D (ModelSource, UsdModelInfo…) — module séparé (Phase 45).
export * from './usd';

// ── Versions & médias ─────────────────────────────────────────────────────────
/** Statut de review personnalisable du studio (Phase 31). */
export interface ReviewStatus {
  id: number;
  name: string;
  color: string; // hex #RRGGBB
  order: number;
  isApproval: boolean;
  isRetake: boolean;
  isDefault: boolean;
}
/** Décision de review historisée d'une version (Phase 31). */
export interface ReviewDecision {
  id: number;
  status: ReviewStatus;
  comment: string | null;
  author: UserRef | null;
  createdAt: string;
}
export interface Version {
  id: number;
  name: string;
  status: VersionStatus;
  published: boolean;
  /** Décision de review courante (dernière posée), null si aucune. */
  reviewStatus?: ReviewStatus | null;
}
/** GET /api/versions?taskId=|assetId= — _count.media filtré par visibilité. */
export type VersionListItem = Version & {
  createdAt: string;
  author: UserRef | null;
  _count: { media: number };
  /** Brouillons de l'appelant dans cette version — publiables d'un geste (Phase 46). */
  draftCount: number;
};
/** GET /api/versions/:id — médias visibles inclus. */
export type VersionDetail = Version & {
  taskId: number | null;
  assetId: number | null;
  media: MediaSummary[];
};

// ── Playlists de dailies (Phase 33) ──────────────────────────────────────────
/** GET /api/playlists?projectId= — liste légère. */
export interface PlaylistSummary {
  id: number;
  projectId: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  createdBy: UserRef | null;
  _count: { items: number };
}
/** Item du détail : version + premier média visible (lecture enchaînée). */
export interface PlaylistItemEntry {
  id: number;
  order: number;
  version: {
    id: number;
    name: string;
    /** Localisation lisible (SQ · SH › tâche, ou asset › tâche). */
    location: string;
    mediaCount: number;
    reviewStatus: Pick<ReviewStatus, 'id' | 'name' | 'color'> | null;
  };
  media: (Pick<Media, 'id' | 'kind' | 'originalName'> & { thumbnailUrl: string | null }) | null;
}
/** GET /api/playlists/:id — items ordonnés. */
export type PlaylistDetail = Omit<PlaylistSummary, '_count'> & { items: PlaylistItemEntry[] };

/** Marqueur de timeline nommé/coloré partagé (Phase 34.C). */
export interface TimelineMarker {
  id: number;
  frame: number;
  name: string;
  color: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
}

/** GET /api/live/sessions?projectId= — session live en cours (badges LIVE, retours 33). */
export interface LiveSessionSummary {
  key: string;
  projectId: number;
  mediaId?: number;
  playlistId?: number;
  versionId?: number;
  participantCount: number;
  pilot: { id: number; displayName: string; initials: string; avatarUrl: string | null } | null;
}

export interface Media {
  id: number;
  kind: MediaKind;
  originalName: string;
  status: MediaStatus;
  published: boolean;
  versionId: number;
  uploaderId: number | null;
}
export type MediaRef = Pick<Media, 'id' | 'kind' | 'originalName'>;
export type MediaSummary = Pick<Media, 'id' | 'kind' | 'originalName' | 'status' | 'published'> & {
  thumbnailUrl?: string | null;
};

// ── Membres du projet ─────────────────────────────────────────────────────────
/** GET /api/projects/:id → memberships. */
export interface Membership {
  id: number;
  role: Role | null;
  user: Pick<User, 'id' | 'name' | 'email' | 'role' | 'username'>;
}

// ── Commentaires de review ────────────────────────────────────────────────────
export interface ReviewReaction {
  id: number;
  emoji: string;
  userId: number | null;
}
export interface ReviewComment {
  id: number;
  /** Média porteur — une réponse vise celui du parent, pas celui affiché à l'écran. */
  mediaObjectId?: number | null;
  content: string;
  timestamp: number | null;
  createdAt: string;
  author: AuthorRef | null;
  guestName: string | null;
  cameraState: unknown;
  annotation: unknown;
  isEdited: boolean;
  /** État du fil (D1) ; absent sur les commentaires antérieurs — voir `stateOf`. */
  state?: 'OPEN' | 'WIP' | 'QUESTION' | 'WONT_FIX' | 'RESOLVED' | null;
  isResolved: boolean;
  /** Note visible du partage client (32) : acceptée par l'API, pilotée par rien avant D1. */
  isVisibleToClient?: boolean;
  assigneeId?: number | null;
  resolvedBy?: AuthorRef | null;
  resolvedAt?: string | null;
  attachments?: CommentAttachment[];
  reactions?: ReviewReaction[];
  replies?: ReviewComment[];
}

// ── Notifications ─────────────────────────────────────────────────────────────
/** referenceId = tâche (TASK_ASSIGNED) ou média (REPLY/COMMENT_ASSIGNED) ; sinon projet. */
export type NotificationType =
  'TASK_ASSIGNED' | 'COMMENT_ASSIGNED' | 'REPLY' | 'MENTION' | 'WATCH' | 'SYSTEM';
export interface Notification {
  id: number;
  type: NotificationType | string;
  /**
   * Clé traduisible et ses paramètres (D2). La phrase était écrite en français EN BASE
   * puis servie telle quelle : `content` reste renvoyé, en anglais, comme repli pour les
   * notifications antérieures.
   */
  messageKey?: string | null;
  params?: Record<string, string | number> | null;
  content: string;
  referenceId: number | null;
  projectId: number | null;
  isRead: boolean;
  createdAt: string;
}

// ── Réglages projet (nomenclature / départements) ─────────────────────────────
export interface Nomenclature {
  sequencePrefix: string;
  shotPrefix: string;
  padding: number;
  step: number;
}
/**
 * Département — étape du pipe (B1). Entité de plein droit : un référentiel de studio
 * (`projectId` null) hérité par défaut, qu'un projet peut remplacer par sa propre liste.
 *
 * `order` n'est pas cosmétique : c'est le rang amont → aval qui décide de « la dernière
 * version » d'un asset ou d'un plan.
 */
export interface Department {
  id: number;
  studioId: number;
  /** Null = référentiel du studio, hérité par tous ses projets. */
  projectId: number | null;
  key: string;
  name: string;
  order: number;
  /** Teinte d'affichage (hex #RRGGBB), normalisée à l'écran par `statusSwatch`. */
  color: string | null;
}
/**
 * Le pipe tel que les réglages et les vues qui en dérivent le renvoient : la table
 * `Department` y est projetée sur `key`/`name`, déjà triée par `order`. L'identité et
 * la teinte ne sont pas sur le fil — n'attendre ici que ces deux champs.
 */
export type DepartmentSummary = Pick<Department, 'key' | 'name'>;
/** Résolution de livraison (px). */
export interface Resolution {
  width: number;
  height: number;
}
/** Réglages pipeline effectifs (résolus) d'une entité — Phase 18. */
export interface PipelineSettings {
  resolution: Resolution;
  framerate: number;
}
/** Override pipeline partiel (séquence/shot) : hérite du parent si absent. */
export interface PipelineOverride {
  resolution?: Resolution;
  framerate?: number;
}
export type NamingMode = 'off' | 'warn' | 'reject';
/** Convention de nommage des fichiers à l'upload (38.C). */
export interface NamingRule {
  pattern: string;
  mode: NamingMode;
}
/** Éclairage HDRI par défaut d'un projet (39.F) — miroir de LightingConfig (review). */
export interface LightingDefault {
  hdriId?: string;
  exposure: number;
  rotationDeg: number;
  showBackground: boolean;
  groundShadow: boolean;
}
/** Gestion de couleur OCIO d'un projet (39.B) : config + display/view. */
export interface ColorSettings {
  configId?: string;
  display?: string;
  view?: string;
}
/** GET /api/projects/:id/settings — aussi la shape des défauts studio (admin). */
export interface ProjectSettings extends PipelineSettings {
  departments: DepartmentSummary[];
  nomenclature: Nomenclature;
  /** Convention de nommage à l'upload (38.C). */
  naming: NamingRule;
  /** Override burn-ins partiel du projet (35.A) — voir types/share.ts. */
  burnin?: Partial<import('./share').BurninConfig>;
  /** Éclairage HDRI par défaut du viewer 3D (39.F), hérité studio→projet. */
  defaultLighting?: LightingDefault;
  /** Gestion de couleur OCIO du projet (39.B) : config + display/view. */
  color?: ColorSettings;
}

// Modules séparés (budget) : partage (35), stats (43.A), planning (43.C), préférences (42.A),
// explorateur d'administration (refonte admin).
export * from './chat';
export * from './profile';
export * from './share';
export * from './admin';
export * from './stats';
export * from './schedule';
export * from './preferences';
export * from './pipeline';
