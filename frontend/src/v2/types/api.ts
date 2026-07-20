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
}
/** Référence minimale (author de version, assignee de tâche). */
export type UserRef = Pick<User, 'id' | 'name'>;
/** Auteur affiché avec avatar (commentaires, documents). */
export type AuthorRef = Pick<User, 'id' | 'name' | 'displayName' | 'initials' | 'avatarUrl'>;

// ── Pipeline : projet / séquence / shot / asset ───────────────────────────────
export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  thumbnailUrl: string | null;
}
export type ProjectRef = Pick<Project, 'id' | 'name'>;

export interface Sequence {
  id: number;
  code: string;
  name: string;
  order: number;
  /** Override pipeline (résolution/fps) hérité du projet — Phase 18/19. */
  settings?: PipelineOverride;
}
export type SequenceRef = Pick<Sequence, 'id' | 'code' | 'name'>;
/** GET /api/sequences?projectId= */
export type SequenceSummary = Sequence & { _count: { shots: number } };

export interface Shot {
  id: number;
  code: string;
  name: string;
  sequenceId: number | null;
  startFrame?: number | null;
  endFrame?: number | null;
  thumbnailUrl?: string | null;
  /** Override pipeline (résolution/fps) hérité séquence→projet — Phase 18/19. */
  settings?: PipelineOverride;
}
export type ShotRef = Pick<Shot, 'id' | 'code' | 'name'>;
/** GET /api/shots?projectId= */
export type ShotSummary = Shot & { _count?: { tasks: number }; assets?: AssetRef[] };

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  thumbnailUrl?: string | null;
}
export type AssetRef = Pick<Asset, 'id' | 'name' | 'type'>;
/** GET /api/assets/:id — liens N-N vers shots/séquences. */
export type AssetDetail = AssetRef & { projectId: number; shots: ShotRef[]; sequences: SequenceRef[] };

// ── Tâches ────────────────────────────────────────────────────────────────────
export interface Task {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
}
/** Listes (kanban, activité projet) : assigné joint. */
export type TaskWithAssignee = Task & { assignee: UserRef | null };
/** Élément de checklist d'une tâche (38.F). */
export interface ChecklistItem {
  text: string;
  done: boolean;
}
/** GET /api/tasks/:id — contexte de localisation (shot/asset + projet). */
export type TaskDetail = Task & {
  shot?: (ShotRef & { project: ProjectRef; sequence?: SequenceRef | null }) | null;
  asset?: (AssetRef & { project: ProjectRef }) | null;
  /** Commentaire de review d'origine (32.D) — lien retour `?comment=`. */
  sourceComment?: { id: number; mediaObjectId: number } | null;
  /** Checklist (38.F) + assigné (pour les droits d'édition). */
  checklist?: ChecklistItem[];
  assignee?: UserRef | null;
};

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
  content: string;
  timestamp: number | null;
  createdAt: string;
  author: AuthorRef | null;
  guestName: string | null;
  cameraState: unknown;
  annotation: unknown;
  isEdited: boolean;
  isResolved: boolean;
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
export interface Department {
  key: string;
  name: string;
}
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
  departments: Department[];
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

// Types du partage client (35.C/35.D) — module séparé pour le budget de lignes.
export * from './share';
// Statistiques de review (43.A) — module séparé (budget de lignes).
export * from './stats';
// Préférences UI par compte (42.A) — module séparé (budget de lignes).
export * from './preferences';
