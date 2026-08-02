import type {
  AuthorRef,
  MediaKind,
  PipelineSettings,
  ProjectSettings,
  ProjectStatus,
  ReviewStatus,
  Role,
  User,
  VersionStatus,
} from './api';

/**
 * Types de l'explorateur d'administration (refonte admin) — miroir des réponses
 * de backend/src/routes/admin-explorer.routes.ts. Module séparé (budget api.ts).
 */

/** Enveloppe de pagination standard du backend (lib/pagination). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Fiche utilisateur (GET /api/admin/users/:id) ─────────────────────────────
export interface AdminUserSession {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}
export interface AdminUserMembership {
  id: number;
  role: Role | null;
  joinedAt: string;
  project: { id: number; name: string; slug: string; status: ProjectStatus; deletedAt: string | null };
}
export interface AdminUserActivity {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  createdAt: string;
}
export interface AdminApiToken {
  id: number;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
export interface AdminUserDetail {
  user: User & {
    lastSeenAt: string | null;
    createdAt: string;
    twoFactorEnabled: boolean;
  };
  memberships: AdminUserMembership[];
  sessions: AdminUserSession[];
  apiTokens: AdminApiToken[];
  activity: AdminUserActivity[];
  counts: { media: number; versions: number; comments: number; tasks: number };
}

// ── Projets (GET /api/admin/projects[/:id]) ──────────────────────────────────
export interface AdminProjectRow {
  id: number;
  name: string;
  slug: string;
  status: ProjectStatus;
  createdAt: string;
  usage: number;
  quota: number | null;
  counts: {
    memberships: number;
    sequences: number;
    shots: number;
    assets: number;
    versions: number;
    media: number;
  };
}
export interface AdminHierarchyShot {
  id: number;
  code: string;
  name: string;
  startFrame: number | null;
  endFrame: number | null;
  override: boolean;
  effective: PipelineSettings;
}
export interface AdminHierarchySequence {
  id: number;
  code: string;
  name: string;
  override: boolean;
  effective: PipelineSettings;
  shots: AdminHierarchyShot[];
}
export interface AdminProjectDetail {
  project: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    status: ProjectStatus;
    startFrame: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    usage: number;
    quota: number | null;
  };
  members: {
    id: number;
    role: Role | null;
    joinedAt: string;
    user: AuthorRef & { email: string; role: Role };
  }[];
  settings: ProjectSettings;
  hierarchy: { sequences: AdminHierarchySequence[]; noSequence: AdminHierarchyShot[] };
  stats: { versions: number; media: number; mediaBytes: number; comments: number; assets: number };
}

// ── Versions globales (GET /api/admin/versions) ──────────────────────────────
export interface AdminVersionRow {
  id: number;
  name: string;
  status: VersionStatus;
  published: boolean;
  createdAt: string;
  author: { id: number; name: string } | null;
  reviewStatus: Pick<ReviewStatus, 'id' | 'name' | 'color'> | null;
  location: string;
  projectId: number | null;
  mediaCount: number;
  kinds: MediaKind[];
  firstMediaId: number | null;
}

// ── Commentaires globaux (GET /api/admin/comments) ───────────────────────────
export interface AdminCommentRow {
  id: number;
  content: string;
  timestamp: number | null;
  isResolved: boolean;
  resolvedAt: string | null;
  parentId: number | null;
  createdAt: string;
  guestName: string | null;
  author: AuthorRef | null;
  media: { id: number; originalName: string; kind: MediaKind };
  replyCount: number;
}

// ── Cartographie stockage (GET /api/admin/storage) ───────────────────────────
export interface StorageAgg {
  count: number;
  bytes: number;
}
export interface AdminStorageProject {
  slug: string;
  objects: number;
  bytes: number;
  projectId: number | null;
  name: string | null;
  deleted: boolean;
}
export interface AdminStorageReport {
  totalObjects: number;
  totalBytes: number;
  categories: Record<string, StorageAgg>;
  derived: Record<string, StorageAgg>;
  studio: Record<string, StorageAgg>;
  projects: AdminStorageProject[];
  generatedAt: string;
}
