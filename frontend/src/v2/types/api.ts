// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommentAttachment } from '../../lib/commentAttachments';

/**
 * Shared API types (10.E2) — one entity, one definition.
 * Mirror of the backend responses (backend/src/routes/* + prisma/schema.prisma): per-endpoint
 * variants are composed with Pick/intersection, here or in the relevant page — never by
 * redeclaring an interface.
 */

// ── Enums (mirror of backend/prisma/schema.prisma) ───────────────────────────
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

// ── Studio announcements (Phase 22) ───────────────────────────────────────────
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
/** GET /api/announcements (admin) — with the number of read receipts. */
export type AnnouncementAdmin = Announcement & { _count: { reads: number } };

/** HLS quality rung (Video context). */
export interface TranscodeRendition {
  height: number;
  videoBitrateK: number;
}
/** GET /api/admin/transcode — video transcoding config (Video context, Phase 22/23). */
export interface TranscodeConfig {
  enabled: boolean;
  crf: number;
  preset: string;
  audioBitrateK: number;
  maxHeight: number;
  ladder: TranscodeRendition[];
  /** Scene detection (34.H): "Shot n" markers placed at cuts (opt-in). */
  sceneDetection?: boolean;
}

/** GET /api/studio/smtp — SMTP config (never the password). */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean;
  envOverride: boolean;
}

// ── Users ─────────────────────────────────────────────────────────────────────
/** Full row of GET /api/users (admin). */
export interface User {
  id: number;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  /** Enriched profile (42.B — №89). */
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
  /** Account created by invitation, link still valid and never used (admin directory). */
  invitePending?: boolean;
}
/** Minimal reference (version author, task assignee). */
export type UserRef = Pick<User, 'id' | 'name'>;
/** Author displayed with avatar (comments, documents). */
export type AuthorRef = Pick<User, 'id' | 'name' | 'displayName' | 'initials' | 'avatarUrl'>;

// Pipeline entities (Project, Sequence, Shot, Asset) — separate module (line budget).
export * from './entities';

// Tasks (Task, TaskWithAssignee, ChecklistItem, TaskDetail) — separate module (line budget).
export * from './task';

// USD & 3D conversion provenance (ModelSource, UsdModelInfo…) — separate module (Phase 45).
export * from './usd';
// Episode level (optional per project) — same rule: one entity, one definition.
export * from './episode';

// ── Versions & media ──────────────────────────────────────────────────────────
/** Studio-customisable review status (Phase 31). */
export interface ReviewStatus {
  id: number;
  name: string;
  color: string; // hex #RRGGBB
  order: number;
  isApproval: boolean;
  isRetake: boolean;
  isDefault: boolean;
}
/** Recorded review decision of a version (Phase 31). */
export interface ReviewDecision {
  id: number;
  status: ReviewStatus;
  comment: string | null;
  author: UserRef | null;
  /**
   * Opinion given from a share link: `author` is null and this name says who gave it. Such an
   * opinion did NOT change the version's status — the studio decides.
   */
  guestName: string | null;
  createdAt: string;
}
export interface Version {
  id: number;
  name: string;
  status: VersionStatus;
  published: boolean;
  /** Current review decision (last one set), null if none. */
  reviewStatus?: ReviewStatus | null;
}
/** GET /api/versions?taskId=|assetId= — _count.media filtered by visibility. */
export type VersionListItem = Version & {
  createdAt: string;
  author: UserRef | null;
  _count: { media: number };
  /** The caller's drafts in this version — publishable in one gesture (Phase 46). */
  draftCount: number;
};
/** GET /api/versions/:id — visible media included. */
export type VersionDetail = Version & {
  taskId: number | null;
  assetId: number | null;
  media: MediaSummary[];
};

// ── Dailies playlists (Phase 33) ─────────────────────────────────────────────
/** GET /api/playlists?projectId= — lightweight list. */
export interface PlaylistSummary {
  id: number;
  projectId: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  createdBy: UserRef | null;
  /**
   * Thumbnails of the first versions (four at most), already signed.
   *
   * A dailies list is identified by what it contains, not by its name: "Dailies Tuesday" and
   * "Dailies Wednesday" can only be told apart by the image.
   */
  previews?: string[];
  _count: { items: number };
}
/** Detail item: version + first visible media (chained playback). */
export interface PlaylistItemEntry {
  id: number;
  order: number;
  version: {
    id: number;
    name: string;
    /** Human-readable location (SQ · SH › task, or asset › task). */
    location: string;
    mediaCount: number;
    reviewStatus: Pick<ReviewStatus, 'id' | 'name' | 'color'> | null;
  };
  media: (Pick<Media, 'id' | 'kind' | 'originalName'> & { thumbnailUrl: string | null }) | null;
}
/** GET /api/playlists/:id — ordered items. */
export type PlaylistDetail = Omit<PlaylistSummary, '_count'> & { items: PlaylistItemEntry[] };

/** Shared named/coloured timeline marker (Phase 34.C). */
export interface TimelineMarker {
  id: number;
  frame: number;
  name: string;
  color: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
}

/** GET /api/live/sessions?projectId= — live session in progress (LIVE badges, feedback 33). */
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

// ── Project members ───────────────────────────────────────────────────────────
/** GET /api/projects/:id → memberships. */
export interface Membership {
  id: number;
  role: Role | null;
  // `avatarUrl`: assignment screens show faces, not lines of text — among twenty similar names,
  // that is what makes someone recognisable at first glance.
  user: Pick<User, 'id' | 'name' | 'email' | 'role' | 'username'> & {
    firstName?: string | null;
    lastName?: string | null;
    avatarUrl?: string | null;
    isService?: boolean;
    /**
     * The person's departments, limited to the vocabulary of THIS project (lot 10). The server
     * filters them: the full list would mix in steps from other projects, which the Members tab
     * can neither show nor remove.
     */
    departments?: Pick<Department, 'id' | 'key' | 'name' | 'color'>[];
  };
}

// ── Review comments ───────────────────────────────────────────────────────────
export interface ReviewReaction {
  id: number;
  emoji: string;
  userId: number | null;
}
export interface ReviewComment {
  id: number;
  /** Carrying media — a reply targets its parent's, not the one displayed on screen. */
  mediaObjectId?: number | null;
  content: string;
  timestamp: number | null;
  createdAt: string;
  author: AuthorRef | null;
  guestName: string | null;
  cameraState: unknown;
  annotation: unknown;
  isEdited: boolean;
  /** Thread state (D1); absent on earlier comments — see `stateOf`. */
  state?: 'OPEN' | 'WIP' | 'QUESTION' | 'WONT_FIX' | 'RESOLVED' | null;
  isResolved: boolean;
  /** Visible note of the client share (32): accepted by the API, driven by nothing before D1. */
  isVisibleToClient?: boolean;
  assigneeId?: number | null;
  resolvedBy?: AuthorRef | null;
  resolvedAt?: string | null;
  attachments?: CommentAttachment[];
  reactions?: ReviewReaction[];
  replies?: ReviewComment[];
}

// ── Notifications ─────────────────────────────────────────────────────────────
/**
 * referenceId = task (TASK_ASSIGNED), playlist (LIVE), or media — and for types carried by a
 * version (REVIEW_ASSIGNED, REVIEW_DECISION), the FIRST media of that version, the only id the
 * viewer knows how to open. Otherwise the project.
 *
 * The type is derived from the kind on the server side (`lib/notificationKinds`): that is what
 * ended the lowercase `review_decision`, which the front end did not recognise.
 */
export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'COMMENT_ASSIGNED'
  | 'REVIEW_ASSIGNED'
  | 'REVIEW_DECISION'
  | 'REPLY'
  | 'MENTION'
  | 'WATCH'
  | 'LIVE'
  | 'SYSTEM';
export interface Notification {
  id: number;
  type: NotificationType | string;
  /**
   * Translatable key and its parameters (D2). The sentence used to be written in French IN THE
   * DATABASE and served as is: `content` is still returned, in English, as a fallback for earlier
   * notifications.
   */
  messageKey?: string | null;
  params?: Record<string, string | number> | null;
  content: string;
  referenceId: number | null;
  projectId: number | null;
  isRead: boolean;
  createdAt: string;
}

// ── Project settings (naming / departments) ───────────────────────────────────
export interface Nomenclature {
  sequencePrefix: string;
  shotPrefix: string;
  padding: number;
  step: number;
}
/**
 * Department — pipeline step (B1). A full-fledged entity: a studio reference (`projectId` null)
 * inherited by default, which a project may replace with its own list.
 *
 * `order` is not cosmetic: it is the upstream → downstream rank that decides "the latest
 * version" of an asset or a shot.
 */
export interface Department {
  id: number;
  studioId: number;
  /** Null = studio reference, inherited by all its projects. */
  projectId: number | null;
  key: string;
  name: string;
  order: number;
  /** Display tint (hex #RRGGBB), normalised on screen by `statusSwatch`. */
  color: string | null;
  /**
   * Department image, already signed by the server. Beyond six steps a colour dot is no longer
   * distinguishable — the studio logo for "Compositing" is.
   */
  imageUrl?: string | null;
  /**
   * Can the person create a task in this step? Advisory: it is what allows offering two entries
   * instead of twelve, but the server re-checks on write — a client does not police itself.
   */
  writable?: boolean;
}
/**
 * The pipeline as the settings and the views derived from it return it: the `Department` table is
 * projected onto `key`/`name`, already sorted by `order`. Identity and tint are not on the wire —
 * expect only these two fields here.
 */
export type DepartmentSummary = Pick<Department, 'key' | 'name'>;
/** Delivery resolution (px). */
export interface Resolution {
  width: number;
  height: number;
}
/** Effective (resolved) pipeline settings of an entity — Phase 18. */
export interface PipelineSettings {
  resolution: Resolution;
  framerate: number;
}
/** Partial pipeline override (sequence/shot): inherits from the parent if absent. */
export interface PipelineOverride {
  resolution?: Resolution;
  framerate?: number;
}
export type NamingMode = 'off' | 'warn' | 'reject';
/** File naming convention on upload (38.C). */
export interface NamingRule {
  pattern: string;
  mode: NamingMode;
}
/**
 * What the project requires when a version's review is assigned to someone.
 *
 * The floor applies to any written brief, even an optional one: a two-character brief is not a
 * short brief, it is a field filled in just to get past it.
 */
export interface ReviewRequestRule {
  /** Is assigning a review without a brief refused? */
  requireNote: boolean;
  /** Minimum length of a written brief, in characters. */
  minNoteLength: number;
}
/** Default HDRI lighting of a project (39.F) — mirror of LightingConfig (review). */
export interface LightingDefault {
  hdriId?: string;
  exposure: number;
  rotationDeg: number;
  showBackground: boolean;
  groundShadow: boolean;
}
/** OCIO colour management of a project (39.B): config + display/view. */
export interface ColorSettings {
  configId?: string;
  display?: string;
  view?: string;
}
/** GET /api/projects/:id/settings — also the shape of the studio defaults (admin). */
export interface ProjectSettings extends PipelineSettings {
  departments: DepartmentSummary[];
  nomenclature: Nomenclature;
  /** Naming convention on upload (38.C). */
  naming: NamingRule;
  /** Brief required when a version's review is assigned. */
  reviewRequest: ReviewRequestRule;
  /** Partial burn-in override of the project (35.A) — see types/share.ts. */
  burnin?: Partial<import('./share').BurninConfig>;
  /** Default HDRI lighting of the 3D viewer (39.F), inherited studio → project. */
  defaultLighting?: LightingDefault;
  /** OCIO colour management of the project (39.B): config + display/view. */
  color?: ColorSettings;
}

// Separate modules (budget): sharing (35), stats (43.A), schedule (43.C), preferences (42.A),
// administration explorer (admin redesign).
export * from './chat';
export * from './profile';
export * from './share';
export * from './admin';
export * from './stats';
export * from './schedule';
export * from './preferences';
export * from './pipeline';
