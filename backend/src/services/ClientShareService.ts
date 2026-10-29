// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import {
  Prisma,
  ShareScope,
  SharePermission,
  type MediaKind,
  type MediaObject,
  type ShareLink,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { imageTypeFromKey } from '../lib/uploadContentType';
import { shareState, verifyShareSession } from '../lib/shareAccess';
import { buildShareBrowse, type ShareBrowse } from './shareBrowse';
import { createGuest, publicAttachments } from './CommentService';
import { splatEditBlobKeys } from '../lib/commentSplatEdit';
import { decideAsGuest, guestStatuses } from './ReviewDecisionService';
import { logAudit } from './AuditService';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors';
import { SETTING_KEYS } from '../lib/settings';

/**
 * Public access through a share link (35.C/35.D): logic shared by the `/api/client` routes. Principle:
 * opening a share session (short-lived JWT) consumes a view; sub-routes require that session, so the view
 * limit cannot be bypassed.
 */

export const STUDIO_LOGO_KEY = SETTING_KEYS.STUDIO_LOGO;

/**
 * Cap on the media served by the public page. A project link on a feature film returned the whole table,
 * without `take`: several thousand rows and as many thumbnail presigned URLs, on every opening. Beyond this
 * cap, the page announces `hasMore`: the answer to a link that shows too much is to narrow it, not to
 * paginate a catalogue in front of a client.
 */
export const SHARE_MEDIA_LIMIT = 200;

/**
 * A shot, sequence or asset that is hidden (`hiddenAt`, see `VisibilityRule`): the item exists, but no
 * internal screen offers it. It had no reason to be offered to the client either, and since the public page
 * now groups media by entity, letting it through would show not just a file name but the **name and code** of
 * what we have just decided to hide.
 *
 * `omitted` (shot cut at mount time) is NOT filtered: this is not a visibility rule, internal screens keep
 * showing it, and a published delivery remains a delivery.
 */
const VISIBLE = { deletedAt: null, hiddenAt: null };

/**
 * Media visible to the client: published, READY, published version, within the shared project. The
 * `deletedAt: null` filters are essential: the trash is a soft delete, and without them a shot moved to the
 * trash stays listed, and downloadable, on the public link although it has disappeared from the internal
 * interface.
 */
export const publishedMediaWhere = (projectId: number) => ({
  status: 'READY' as const,
  published: true,
  deletedAt: null,
  version: {
    published: true,
    deletedAt: null,
    OR: [
      // The sequence is optional (a shot without a sequence is a normal case): we only require its visibility
      // when there is one, otherwise the internal `OR` would exclude the shot.
      {
        task: {
          shot: {
            projectId,
            ...VISIBLE,
            OR: [{ sequenceId: null }, { sequence: VISIBLE }],
          },
        },
      },
      { task: { asset: { projectId, ...VISIBLE } } },
      { asset: { projectId, ...VISIBLE } },
    ],
  },
});

/** What must be known about a link to decide what it opens. */
export interface ShareScopeRef {
  projectId: number;
  scope: ShareScope;
  playlistId: number | null;
  versionId: number | null;
  /** Explicit selection (MEDIA scope); empty for the other scopes. */
  mediaIds: number[];
}

/** Loaded link, its media selection flattened to identifiers. */
export type ShareRecord = ShareLink & { mediaIds: number[] };

/**
 * Filter that retains no media. A scope whose target has disappeared must not fall back to "the whole
 * project": that is exactly the silent widening the scope exists to prevent.
 */
const MATCHES_NOTHING: Prisma.MediaObjectWhereInput = { id: { in: [] } };

/**
 * What THIS link opens: to be applied everywhere sharing reads a media (list, presigned URL, comment thread),
 * and not only when displaying the list; otherwise a client who was only shown one shot could download the
 * others by guessing their id.
 */
export function shareMediaWhere(share: ShareScopeRef): Prisma.MediaObjectWhereInput {
  const base = publishedMediaWhere(share.projectId);
  switch (share.scope) {
    case ShareScope.PLAYLIST:
      return share.playlistId == null
        ? MATCHES_NOTHING
        : {
            ...base,
            version: { ...base.version, playlistItems: { some: { playlistId: share.playlistId } } },
          };
    case ShareScope.VERSION:
      return share.versionId == null ? MATCHES_NOTHING : { ...base, versionId: share.versionId };
    case ShareScope.MEDIA:
      return share.mediaIds.length === 0 ? MATCHES_NOTHING : { ...base, id: { in: share.mediaIds } };
    case ShareScope.PROJECT:
    default:
      return base;
  }
}

/** Token link, or 404 if unknown/revoked/expired (without distinguishing, against enumeration). */
export async function loadShare(token: string): Promise<ShareRecord> {
  const share = await prisma.shareLink.findUnique({
    where: { token },
    include: { media: { select: { mediaObjectId: true } } },
  });
  if (!share) throw notFound('Invalid or expired link');
  const state = shareState(share);
  if (state === 'revoked' || state === 'expired') throw notFound('Invalid or expired link');
  const { media, ...rest } = share;
  return { ...rest, mediaIds: media.map((m) => m.mediaObjectId) };
}

/**
 * Sub-routes: valid link + mandatory share session (`X-Share-Auth` header).
 * An exhausted link remains readable for a session already open (the view is counted).
 */
export async function loadShareWithSession(token: string, req: Request): Promise<ShareRecord> {
  const share = await loadShare(token);
  if (!verifyShareSession(req.header('x-share-auth') ?? undefined, share.id)) {
    throw unauthorized('A share session is required');
  }
  return share;
}

/**
 * What must be known about a media to FILE it: its version, and the path up to its parent. The three branches
 * are exactly those of the `OR` in `publishedMediaWhere`: the `select` follows them at once rather than
 * issuing one query per entity.
 */
const shareTreeSelect = {
  id: true,
  kind: true,
  originalName: true,
  thumbnailKey: true,
  createdAt: true,
  version: {
    select: {
      id: true,
      name: true,
      // Version set DIRECTLY on an asset, without going through a task.
      asset: { select: { id: true, name: true, type: true, typeLabel: true } },
      task: {
        select: {
          name: true,
          asset: { select: { id: true, name: true, type: true, typeLabel: true } },
          shot: {
            select: {
              id: true,
              code: true,
              name: true,
              order: true,
              sequence: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  order: true,
                  episode: { select: { id: true, code: true, name: true, order: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MediaObjectSelect;

type ShareMediaRow = Prisma.MediaObjectGetPayload<{ select: typeof shareTreeSelect }>;

/** A tile of the public page, with what is needed to locate it. */
export interface ShareMediaTile {
  id: number;
  kind: MediaKind;
  originalName: string;
  thumbnailUrl: string | null;
  createdAt: string;
  version: { id: number; name: string; taskName: string | null };
  /** This link has already given its verdict on this version: the home queue leaves it out. */
  decided: boolean;
  /** Where the media is filed. Keys, never labels: rendering reads the nodes. */
  placement: {
    episodeId: number | null;
    sequenceId: number | null;
    shotId: number | null;
    assetId: number | null;
  };
}

/**
 * On which versions has THIS link already given its verdict? This feeds the home page's "awaiting your
 * feedback" queue: a returning client must find where they were, not restart reading a grid from newest to
 * oldest.
 */
async function decidedVersionIds(shareLinkId: number, versionIds: number[]): Promise<Set<number>> {
  if (versionIds.length === 0) return new Set();
  const rows = await prisma.reviewDecision.findMany({
    where: { shareLinkId, versionId: { in: versionIds } },
    select: { versionId: true },
    distinct: ['versionId'],
  });
  return new Set(rows.map((r) => r.versionId));
}

/** Filing of a row, identifiers only. */
function placementOf(row: ShareMediaRow): ShareMediaTile['placement'] {
  const shot = row.version.task?.shot ?? null;
  const asset = row.version.asset ?? row.version.task?.asset ?? null;
  return {
    episodeId: shot?.sequence?.episode?.id ?? null,
    sequenceId: shot?.sequence?.id ?? null,
    shotId: shot?.id ?? null,
    assetId: asset?.id ?? null,
  };
}

/**
 * The link's media, bounded, with the tree that goes with them, and what is needed to tell the recipient that
 * they do not have everything.
 *
 * **A single `findMany`**: same `where`, same `orderBy`, same `take` as before; only the `select` has been
 * enriched. The tree is DERIVED from these rows, never queried from `projectId`: it is the only mechanism
 * guaranteeing that a MEDIA-scope link does not name the neighbouring shot. And a single presigned URL per
 * media, as before: the nodes only carry a `coverMediaId`, not one more thumbnail to sign.
 */
export async function listShareMedia(
  share: ShareScopeRef,
  shareLinkId: number,
): Promise<{ media: ShareMediaTile[]; browse: ShareBrowse; total: number; hasMore: boolean }> {
  const where = shareMediaWhere(share);
  const [rows, total] = await Promise.all([
    prisma.mediaObject.findMany({
      where,
      // `id` breaks ties: two media created in the same millisecond (a batch import) would swap places from
      // one call to the next.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SHARE_MEDIA_LIMIT,
      select: shareTreeSelect,
    }),
    prisma.mediaObject.count({ where }),
  ]);
  const decided = await decidedVersionIds(shareLinkId, [...new Set(rows.map((m) => m.version.id))]);
  const media = await Promise.all(
    rows.map(async (m) => ({
      id: m.id,
      kind: m.kind,
      originalName: m.originalName,
      thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
      createdAt: m.createdAt.toISOString(),
      version: { id: m.version.id, name: m.version.name, taskName: m.version.task?.name ?? null },
      decided: decided.has(m.version.id),
      placement: placementOf(m),
    })),
  );
  return { media, browse: buildShareBrowse(rows), total, hasMore: total > rows.length };
}

/**
 * Which playlists THIS link names.
 *
 * - `PROJECT`: those of the project that contain at least one media in scope. The `some` is written with
 * `shareMediaWhere` itself,
 *   so a playlist cannot serve as a pass to a draft or to the trash.
 * - `PLAYLIST`: the link's own, pinned by `id` AND `projectId`.
 * - `VERSION` / `MEDIA`: **none**. `null`, not a computed list: naming "the playlists containing this
 * version" would reveal the
 *   existence of dailies the recipient never received. A scope that shows only one shot names nothing else.
 * - `PLAYLIST` without a target: `null` too; a scope whose target has disappeared does not fall back to
 * "everything", even for a
 *   mere list of names.
 */
export function sharePlaylistWhere(share: ShareScopeRef): Prisma.PlaylistWhereInput | null {
  const holdsVisibleMedia = { some: { version: { media: { some: shareMediaWhere(share) } } } };
  switch (share.scope) {
    case ShareScope.PROJECT:
      return { projectId: share.projectId, items: holdsVisibleMedia };
    case ShareScope.PLAYLIST:
      return share.playlistId == null
        ? null
        : { id: share.playlistId, projectId: share.projectId, items: holdsVisibleMedia };
    default:
      return null;
  }
}

/** Beyond this, a sharing home page stops being a home page. */
export const SHARE_PLAYLIST_LIMIT = 30;

/** A playlist card on the home page: identifiers, never one more thumbnail. */
export interface SharePlaylistCard {
  id: number;
  name: string;
  updatedAt: string;
  /** Items in scope: may exceed `mediaIds.length` when the page is bounded. */
  itemCount: number;
  /** Playlist media PRESENT in the page served, in playlist order. */
  mediaIds: number[];
  coverMediaIds: number[];
}

/**
 * Home-page playlist cards. The identifiers are **intersected** with the media page already returned: an
 * identifier beyond the cap would point to a tile absent from the payload, hence an empty thumbnail.
 * `itemCount`, for its part, remains the total in scope: the card tells the truth about what the playlist
 * contains; the grid only shows what it can open.
 */
export async function listSharePlaylists(
  share: ShareScopeRef,
  visibleMediaIds: ReadonlySet<number>,
): Promise<SharePlaylistCard[]> {
  const where = sharePlaylistWhere(share);
  if (!where) return [];
  const inScope = { version: { media: { some: shareMediaWhere(share) } } };
  const playlists = await prisma.playlist.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: SHARE_PLAYLIST_LIMIT,
    select: {
      id: true,
      name: true,
      updatedAt: true,
      // Counter FILTERED by the scope: a bare `_count` would announce "12" for three openable items.
      _count: { select: { items: { where: inScope } } },
      items: {
        where: inScope,
        orderBy: { order: 'asc' },
        select: {
          version: {
            select: {
              media: {
                where: shareMediaWhere(share),
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: { id: true }, // identifiers: no extra signature
              },
            },
          },
        },
      },
    },
  });
  return playlists.map((playlist) => {
    const mediaIds = playlist.items
      .flatMap((item) => item.version.media.map((m) => m.id))
      .filter((id) => visibleMediaIds.has(id));
    return {
      id: playlist.id,
      name: playlist.name,
      updatedAt: playlist.updatedAt.toISOString(),
      itemCount: playlist._count.items,
      mediaIds,
      coverMediaIds: mediaIds.slice(0, 4),
    };
  });
}

/**
 * A specific media, if it is within the link's scope. The `AND` is not cosmetic: the MEDIA scope itself sets
 * an `id` filter, which a literal object would overwrite.
 */
export async function findShareMedia(share: ShareScopeRef, id: number): Promise<MediaObject> {
  const media = await prisma.mediaObject.findFirst({ where: { AND: [{ id }, shareMediaWhere(share)] } });
  if (!media) throw notFound('Media not found, or not published');
  return media;
}

/**
 * The thread a guest reads: **column allow-list**, not an `include` on the whole row. Without a `select`,
 * Prisma returns all scalar columns: `attachments` (MinIO keys), `assigneeId`, `resolvedById`, `state`,
 * `timelineId` would leave on a public page although nothing displays them there. `annotation` is the only
 * field added, and it is added deliberately: it lets the client see again the drawing we show them, and the
 * one they just placed.
 *
 * `OR: [{ timelineId: null }, { sharedToShot: true }]`: a feedback written from an edit belongs only to that
 * edit as long as no one has sent it back to the shot's review. The internal thread has enforced this guard
 * since Phase 46; the public route had forgotten it.
 */
/** Attachments of a comment, minus the binaries its edit proposal references. */
export function dropSplatEditBlobs(attachments: unknown, annotation: unknown): unknown {
  if (!Array.isArray(attachments)) return attachments;
  const keys = splatEditBlobKeys(annotation);
  if (keys.length === 0) return attachments;
  return (attachments as { key?: string }[]).filter((a) => !a.key || !keys.includes(a.key));
}

export async function listShareComments(mediaObjectId: number) {
  const rows = await prisma.comment.findMany({
    where: {
      mediaObjectId,
      parentId: null,
      isVisibleToClient: true,
      OR: [{ timelineId: null }, { sharedToShot: true }],
    },
    orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      content: true,
      timestamp: true,
      duration: true,
      guestName: true,
      createdAt: true,
      isEdited: true,
      annotation: true,
      // `id` + `name` and nothing else: the thread displays them, and the identifier serves as the render
      // key. No email, avatar or role comes down to a public page.
      author: { select: { id: true, name: true } },
      // The keys do NOT come down: `publicAttachments` exchanges them for presigned URLs. Without this, an
      // image attached by the studio remained invisible to the client, who read "view the attachment" nowhere
      // and saw only text.
      attachments: true,
    },
  });
  return Promise.all(
    rows.map(async ({ attachments, ...comment }) => ({
      ...comment,
      // The binaries of a cloud-edit proposal (mask, ops) are stored as attachments — that is what gives them
      // their purge — but they are not files on offer: on a public page they would come down as presigned
      // URLs to a bitset no one opens. Excluded by their key, before presigning.
      attachments: await publicAttachments(dropSplatEditBlobs(attachments, comment.annotation)),
    })),
  );
}

/** The two answers this link may give, or `null` if it has no right to give any. */
export async function shareDecisionStatuses(share: ShareRecord) {
  if (share.permission !== SharePermission.DECIDE) return null;
  return guestStatuses(share.projectId);
}

/** What a guest sends with their feedback. Free-form shapes are revalidated on write. */
export interface ShareCommentInput {
  guestName: string;
  content: string;
  timestamp?: number;
  cameraState?: unknown;
  annotation?: unknown;
}

/**
 * A guest's feedback. Two guards before writing, in this order: the link's **permission** (a read-only link
 * does not become commentable because a valid body is posted to it), then the **scope**: `findShareMedia`
 * refuses a guessed identifier, including that of a media in the same project.
 *
 * `createGuest` then triggers the same chain as an internal feedback (followers, webhooks, v1 journal,
 * ShotGrid note): a client's feedback is not a second-class citizen.
 */
/**
 * A guest's opinion on the version carried by a media — **an opinion, not a verdict**.
 *
 * Three guards, in this order: the link's **permission** (only `DECIDE` grants this right; commenting and
 * giving a verdict are not the same mandate), the **scope**: `findShareMedia` refuses a guessed identifier,
 * then the **status**, which `decideAsGuest` restricts to the two answers offered. The version's current
 * status is never touched.
 */
export async function createShareDecision(
  share: ShareRecord,
  mediaObjectId: number,
  body: { guestName: string; statusId: number; comment?: string },
) {
  if (share.permission !== SharePermission.DECIDE) throw forbidden('This link cannot record a decision');
  const media = await findShareMedia(share, mediaObjectId);
  return decideAsGuest(
    { name: body.guestName, shareLinkId: share.id },
    share.projectId,
    media.versionId,
    body.statusId,
    body.comment,
  );
}

export async function createShareComment(
  share: ShareRecord,
  mediaObjectId: number,
  body: ShareCommentInput,
  ip?: string,
) {
  if (share.permission !== SharePermission.COMMENT) throw forbidden('This link is read-only');
  await findShareMedia(share, mediaObjectId);
  const comment = await createGuest(
    { name: body.guestName, shareLinkId: share.id, shareOwnerId: share.createdById },
    share.projectId,
    {
      mediaObjectId,
      content: body.content,
      timestamp: body.timestamp,
      cameraState: body.cameraState,
      annotation: body.annotation,
    },
  );
  // A guest's feedback used to leave only the webhook payload as a trace: the audit log now says which link
  // wrote it, and on which media. Without the text of the feedback: the log is shown on the admin screen and
  // copied into pino.
  logAudit({
    action: 'SHARE_COMMENT',
    entityType: 'Project',
    entityId: share.projectId,
    metadata: {
      shareLinkId: share.id,
      mediaObjectId,
      hasAnnotation: body.annotation != null,
      ip: ip ?? null,
    },
  });
  return comment;
}

/**
 * Consumes a view (atomic increment, bounded by `maxViews` on the SQL side to avoid any race). Throws 410 if
 * the limit has been reached.
 */
export async function consumeView(share: ShareLink): Promise<void> {
  const where =
    share.maxViews != null ? { id: share.id, viewCount: { lt: share.maxViews } } : { id: share.id };
  const updated = await prisma.shareLink.updateMany({
    where,
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });
  if (updated.count === 0) throw new AppError('This link has reached its view limit', 410);
}

/** Studio skinning of the client page: name + logo (Setting `studio_logo_key`, presigned). */
export async function studioBranding(): Promise<{ name: string; logoUrl: string | null }> {
  const [studio, logo] = await Promise.all([
    prisma.studio.findFirst({ select: { name: true } }),
    prisma.setting.findUnique({ where: { key: STUDIO_LOGO_KEY } }),
  ]);
  return {
    name: studio?.name ?? 'ReView',
    logoUrl: logo?.value
      ? await storage.getPresignedGetUrl(logo.value, 3600, imageTypeFromKey(logo.value))
      : null,
  };
}
