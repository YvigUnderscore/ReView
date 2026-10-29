// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma } from '@prisma/client';

/**
 * Representations of the v1 API resources: the public contract.
 *
 * These shapes are deliberately decoupled from the Prisma schema: a column can be renamed,
 * denormalized or moved without DCC integrations suffering. Each resource carries its canonical
 * `path` (see `lib/pipelinePath`), which lets a client start from a response to query the API
 * without ever handling an identifier.
 */

// ── Prisma selections (source of the output types) ───────────────────────────

export const projectSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  description: true,
  startFrame: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

export const sequenceSelect = {
  id: true,
  name: true,
  code: true,
  order: true,
  projectId: true,
  project: { select: { slug: true } },
} satisfies Prisma.SequenceSelect;

export const shotSelect = {
  id: true,
  name: true,
  code: true,
  startFrame: true,
  endFrame: true,
  order: true,
  projectId: true,
  project: { select: { slug: true } },
  sequence: { select: { id: true, code: true } },
} satisfies Prisma.ShotSelect;

export const assetSelect = {
  id: true,
  name: true,
  type: true,
  description: true,
  projectId: true,
  project: { select: { slug: true } },
} satisfies Prisma.AssetSelect;

export const taskSelect = {
  id: true,
  name: true,
  type: true,
  department: true,
  status: true,
  order: true,
  startDate: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, name: true, username: true, email: true } },
  shot: {
    select: {
      id: true,
      code: true,
      projectId: true,
      project: { select: { slug: true } },
      sequence: { select: { code: true } },
    },
  },
  asset: { select: { id: true, name: true, projectId: true, project: { select: { slug: true } } } },
} satisfies Prisma.TaskSelect;

export const mediaSelect = {
  id: true,
  kind: true,
  status: true,
  originalName: true,
  mimeType: true,
  size: true,
  published: true,
  createdAt: true,
} satisfies Prisma.MediaObjectSelect;

export const versionSelect = {
  id: true,
  name: true,
  status: true,
  published: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, username: true, email: true } },
  reviewStatus: { select: { id: true, name: true, color: true } },
  task: { select: taskSelect },
  asset: { select: assetSelect },
} satisfies Prisma.VersionSelect;

export const commentSelect = {
  id: true,
  content: true,
  timestamp: true,
  duration: true,
  isResolved: true,
  isVisibleToClient: true,
  createdAt: true,
  mediaObjectId: true,
  parentId: true,
  guestName: true,
  author: { select: { id: true, name: true, username: true, email: true } },
} satisfies Prisma.CommentSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;
type SequenceRow = Prisma.SequenceGetPayload<{ select: typeof sequenceSelect }>;
type ShotRow = Prisma.ShotGetPayload<{ select: typeof shotSelect }>;
type AssetRow = Prisma.AssetGetPayload<{ select: typeof assetSelect }>;
type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
type VersionRow = Prisma.VersionGetPayload<{ select: typeof versionSelect }>;
type MediaRow = Prisma.MediaObjectGetPayload<{ select: typeof mediaSelect }>;
type CommentRow = Prisma.CommentGetPayload<{ select: typeof commentSelect }>;

// ── Actors ─────────────────────────────────────────────────────────────────

export interface V1Actor {
  id: number;
  name: string;
}

type ActorRow = { id: number; name: string | null; username: string | null; email: string } | null;

/** Display name of an actor: username, then name, then the local part of the email address. */
export const toActor = (row: ActorRow): V1Actor | null =>
  row ? { id: row.id, name: row.username ?? row.name ?? row.email.split('@')[0] ?? String(row.id) } : null;

// ── Resources ──────────────────────────────────────────────────────────────

export const toProject = (row: ProjectRow) => ({
  id: row.id,
  code: row.slug,
  name: row.name,
  status: row.status,
  description: row.description,
  startFrame: row.startFrame,
  path: row.slug,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toSequence = (row: SequenceRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  order: row.order,
  projectId: row.projectId,
  path: `${row.project.slug}/${row.code}`,
});

/** Canonical path of a shot: under its sequence, or under `shots/` if it has none. */
const shotPath = (projectSlug: string, sequenceCode: string | null | undefined, code: string): string =>
  sequenceCode ? `${projectSlug}/${sequenceCode}/${code}` : `${projectSlug}/shots/${code}`;

export const toShot = (row: ShotRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  startFrame: row.startFrame,
  endFrame: row.endFrame,
  order: row.order,
  projectId: row.projectId,
  sequence: row.sequence ? { id: row.sequence.id, code: row.sequence.code } : null,
  path: shotPath(row.project.slug, row.sequence?.code, row.code),
});

export const toAsset = (row: AssetRow) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  description: row.description,
  projectId: row.projectId,
  path: `${row.project.slug}/assets/${row.name}`,
});

/** Parent of a task: a shot or an asset, never both, never neither. */
const taskParent = (row: TaskRow) => {
  if (row.shot) {
    return {
      kind: 'shot' as const,
      id: row.shot.id,
      code: row.shot.code,
      projectId: row.shot.projectId,
      path: shotPath(row.shot.project.slug, row.shot.sequence?.code, row.shot.code),
    };
  }
  if (row.asset) {
    return {
      kind: 'asset' as const,
      id: row.asset.id,
      code: row.asset.name,
      projectId: row.asset.projectId,
      path: `${row.asset.project.slug}/assets/${row.asset.name}`,
    };
  }
  return null;
};

export const toTask = (row: TaskRow) => {
  const parent = taskParent(row);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    order: row.order,
    startDate: row.startDate,
    dueDate: row.dueDate,
    assignee: toActor(row.assignee),
    parent,
    projectId: parent?.projectId ?? null,
    path: parent ? `${parent.path}/${row.name}` : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

export const toMedia = (row: MediaRow) => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  filename: row.originalName,
  mimeType: row.mimeType,
  size: Number(row.size),
  published: row.published,
  createdAt: row.createdAt,
});

export const toVersion = (row: VersionRow & { media?: MediaRow[] }) => {
  const parent = row.task ? toTask(row.task).parent : null;
  const parentPath = row.task ? (toTask(row.task).path ?? null) : row.asset ? toAsset(row.asset).path : null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    published: row.published,
    author: toActor(row.author),
    reviewStatus: row.reviewStatus,
    task: row.task ? { id: row.task.id, name: row.task.name } : null,
    asset: row.asset ? { id: row.asset.id, name: row.asset.name } : null,
    projectId: parent?.projectId ?? row.asset?.projectId ?? null,
    path: parentPath ? `${parentPath}/${row.name}` : null,
    media: row.media?.map(toMedia),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

export const toComment = (row: CommentRow) => ({
  id: row.id,
  content: row.content,
  /** Position in the video, in seconds (null outside a time-based media). */
  timestamp: row.timestamp,
  duration: row.duration,
  resolved: row.isResolved,
  visibleToClient: row.isVisibleToClient,
  mediaId: row.mediaObjectId,
  parentId: row.parentId,
  // A comment posted through a share link has no author in the database, only a name.
  author: toActor(row.author) ?? (row.guestName ? { id: 0, name: row.guestName } : null),
  createdAt: row.createdAt,
});
