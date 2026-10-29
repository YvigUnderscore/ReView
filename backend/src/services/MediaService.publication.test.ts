// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaKind, MediaStatus, Role } from '@prisma/client';

/**
 * Automatic publication (Phase 50) — the batch that removes "publish" from the list of gestures.
 *
 * Three rules play out here, and they hold together: a media is born published unless the studio kept draft
 * mode; the mandatory brief, which used to refuse publication, now refuses the upload; and a published media
 * whose processing failed keeps the right to ONE retry, failing which it would be dead for ever.
 */

const { db } = vi.hoisted(() => ({
  db: {
    mediaObject: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    version: { findUnique: vi.fn(), update: vi.fn() },
    projectMembership: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    // The retry counter is read and spent UNDER ROW LOCK (CP-SEC phase 50): `reprocess` therefore goes
    // through an interactive transaction. The stub plays it flat, with the
    // same client — what the test exercises is the counter's rule, not the lock, which only makes sense
    // against a real database (and which the integration test exercises).
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/storage', () => ({
  storage: {
    getPresignedPutUrl: vi.fn(),
    getPresignedGetUrl: vi.fn(),
    statObject: vi.fn(),
    getObjectHeader: vi.fn(),
    setObjectContentType: vi.fn(),
    deleteObject: vi.fn(),
  },
  StorageService: { mediaKey: vi.fn(() => 'projects/p/sh/v/1/f.mov'), thumbnailKey: vi.fn() },
}));
vi.mock('../lib/queues', () => ({
  enqueueMediaJob: vi.fn(() => Promise.resolve()),
  enqueueSpatialThumb: vi.fn(() => Promise.resolve()),
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
vi.mock('./ChatNotifyService', () => ({ notifyChat: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./ReviewAssignmentService', () => ({ listReviewers: vi.fn(), setReviewers: vi.fn() }));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../lib/clamav', () => ({ isClamavEnabled: () => false }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../lib/projectRoles', () => ({ assertCanContribute: vi.fn(), isProjectManager: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectQuota', () => ({ assertProjectQuota: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForVersion: vi.fn(() => Promise.resolve(PROJECT)),
  resolveStorageContextForVersion: vi.fn(() =>
    Promise.resolve({ projectId: PROJECT, projectSlug: 'demo', parentSegment: 'sh0010', versionName: 'v01' }),
  ),
}));
vi.mock('../lib/settings', () => ({
  getNumericSetting: vi.fn(() => Promise.resolve(Number.MAX_SAFE_INTEGER)),
  getLiveSyncHz: vi.fn(() => Promise.resolve(2)),
  isDraftModeEnabled: vi.fn(() => Promise.resolve(false)),
  SETTING_KEYS: {
    MAX_FILE_SIZE: 'max_file_size',
    MAX_CONCURRENT_UPLOADS: 'max_concurrent_uploads',
    STORAGE_LIMIT_USER: 'storage_limit_user',
  },
}));
// The brief rule remains REAL (`checkReviewNote`): it is that which is exercised. Only the reading of the
// project's settings is simulated.
vi.mock('../lib/projectSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projectSettings')>()),
  resolveProjectSettingsById: vi.fn(),
}));
// The deposited content is not the subject of the test: detection is simulated, the magic bytes are exercised
// in `lib/fileSignatures`.
vi.mock('../lib/fileSignatures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/fileSignatures')>()),
  validateMediaHeader: vi.fn(() => 'mov'),
}));

import { createUpload, finalize, reprocess } from './MediaService';
import { storage } from '../lib/storage';
import { enqueueMediaJob } from '../lib/queues';
import { isDraftModeEnabled } from '../lib/settings';
import { resolveProjectSettingsById } from '../lib/projectSettings';
import { notifyWatchers } from './WatchService';

const PROJECT = 42;
const USER = { id: 7, role: Role.ARTIST };

/** The project settings, reduced to the two sections this path reads. */
const settings = (requireNote: boolean, minNoteLength = 5) =>
  ({ naming: { pattern: '', mode: 'off' }, reviewRequest: { requireNote, minNoteLength } }) as never;

const upload = () => ({
  versionId: 3,
  filename: 'sh0010_comp_v001.mov',
  contentType: 'video/quicktime',
  kind: MediaKind.VIDEO,
  size: 1024,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isDraftModeEnabled).mockResolvedValue(false);
  vi.mocked(resolveProjectSettingsById).mockResolvedValue(settings(false));
  db.mediaObject.count.mockResolvedValue(0);
  db.mediaObject.aggregate.mockResolvedValue({ _sum: { size: 0n } });
  db.mediaObject.create.mockResolvedValue({ id: 1 });
  // Prisma returns the WHOLE ROW after an update: `published` is part of it, and it is what decides whether
  // finalization announces the publication. A mock returning only the
  // written `data` would leave this path silent without anything signalling it.
  db.mediaObject.update.mockImplementation((args: { data: Record<string, unknown> }) => ({
    id: 1,
    versionId: 3,
    kind: MediaKind.VIDEO,
    originalName: 'sh0010_comp_v001.mov',
    published: true,
    size: 0n,
    metadata: {},
    ...args.data,
  }));
  // Serves two reads: the published state of the parent (createUpload) and the list of media that
  // `syncVersionPublication` counts. An empty version is not published — neutral default.
  db.version.findUnique.mockResolvedValue({ published: false, media: [] });
  db.user.findUnique.mockResolvedValue({ storageLimit: null });
  vi.mocked(storage.getPresignedPutUrl).mockResolvedValue('https://minio.invalid/put');
});

describe('createUpload: birth published according to the `draftMode` setting', () => {
  it('publishes automatically when draft mode is disabled (default)', async () => {
    const res = await createUpload(USER, upload());

    expect(res.published).toBe(true);
    expect(db.mediaObject.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ published: true }) }),
    );
  });

  it('keeps the draft when draft mode is active', async () => {
    vi.mocked(isDraftModeEnabled).mockResolvedValue(true);

    const res = await createUpload(USER, upload());

    expect(res.published).toBe(false);
    expect(db.mediaObject.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ published: false }) }),
    );
  });

  it('in draft mode, still inherits the version already published', async () => {
    vi.mocked(isDraftModeEnabled).mockResolvedValue(true);
    db.version.findUnique.mockResolvedValue({ published: true });

    expect((await createUpload(USER, upload())).published).toBe(true);
  });
});

describe('finalize: mandatory brief moved to the upload', () => {
  beforeEach(() => {
    db.mediaObject.findUnique.mockResolvedValue({
      id: 1,
      versionId: 3,
      kind: MediaKind.VIDEO,
      originalName: 'sh0010_comp_v001.mov',
      storageKey: 'projects/demo/sh0010/v01/1/f.mov',
      status: MediaStatus.UPLOADING,
      published: true,
      uploaderId: USER.id,
      metadata: {},
    });
    vi.mocked(storage.statObject).mockResolvedValue({ size: 2048, contentType: 'video/quicktime' });
    vi.mocked(storage.getObjectHeader).mockResolvedValue(Buffer.alloc(32));
    vi.mocked(storage.setObjectContentType).mockResolvedValue(undefined);
  });

  it('refuses the upload without a brief when the project requires one — before any call to storage', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(settings(true));

    await expect(finalize(USER, 1)).rejects.toMatchObject({
      statusCode: 400,
      code: 'UPLOAD_NOTE_REQUIRED',
    });
    // Nothing has been touched: the client can call `finalize` again with its brief.
    expect(storage.statObject).not.toHaveBeenCalled();
    expect(db.mediaObject.update).not.toHaveBeenCalled();
  });

  it("refuses a brief shorter than the project's floor", async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(settings(true, 10));

    await expect(finalize(USER, 1, 'ok')).rejects.toMatchObject({
      statusCode: 400,
      code: 'UPLOAD_NOTE_TOO_SHORT',
    });
  });

  it('accepts the upload with its brief, and keeps it in the metadata', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(settings(true));

    await finalize(USER, 1, '  Regarder le raccord au 1042  ');

    expect(db.mediaObject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: { uploadNote: 'Regarder le raccord au 1042' } }),
      }),
    );
  });

  it('lets through the upload without a brief when the project does not require one', async () => {
    await expect(finalize(USER, 1)).resolves.toMatchObject({ detectedExtension: 'mov' });
  });

  it('announces the automatic publication: the version follows, the followers are alerted', async () => {
    db.version.findUnique.mockResolvedValue({
      published: false,
      media: [{ published: true, status: MediaStatus.READY }],
    });

    await finalize(USER, 1);

    expect(db.version.update).toHaveBeenCalled();
    expect(notifyWatchers).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'notification.mediaPublished' }),
    );
  });

  it('in draft mode, announces nothing: "publish" remains a gesture', async () => {
    vi.mocked(isDraftModeEnabled).mockResolvedValue(true);
    db.version.findUnique.mockResolvedValue({
      published: false,
      media: [{ published: true, status: MediaStatus.READY }],
    });

    await finalize(USER, 1);

    expect(db.version.update).not.toHaveBeenCalled();
    expect(notifyWatchers).not.toHaveBeenCalled();
  });
});

describe('reprocess: a retry after failure, none on a healthy media', () => {
  /** `assertMediaManage` passes: the user is a supervisor of the project. */
  const manage = { id: 7, role: Role.SUPERVISOR };

  const media = (over: Record<string, unknown>) => ({
    id: 1,
    versionId: 3,
    uploaderId: manage.id,
    kind: MediaKind.MODEL_3D,
    originalName: 'asset.fbx',
    published: true,
    status: MediaStatus.FAILED,
    metadata: {},
    ...over,
  });

  beforeEach(() => {
    db.version.findUnique.mockResolvedValue({ asset: { projectId: PROJECT }, task: null });
    db.projectMembership.findUnique.mockResolvedValue({ userId: manage.id, projectId: PROJECT, role: null });
  });

  it('refuses the retry of a HEALTHY published media, with its own code', async () => {
    db.mediaObject.findUnique.mockResolvedValue(media({ status: MediaStatus.READY }));

    await expect(reprocess(manage, 1)).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPROCESS_ONLY_AFTER_FAILURE',
    });
    expect(enqueueMediaJob).not.toHaveBeenCalled();
  });

  it('allows the first retry of a published media in failure, and counts it', async () => {
    db.mediaObject.findUnique.mockResolvedValue(media({}));

    const res = await reprocess(manage, 1);

    expect(res.requeued).toBe(true);
    expect(db.mediaObject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: { publishedReprocessCount: 1 } }),
      }),
    );
  });

  it('refuses the second retry, the counter having been consumed', async () => {
    db.mediaObject.findUnique.mockResolvedValue(media({ metadata: { publishedReprocessCount: 1 } }));

    await expect(reprocess(manage, 1)).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPROCESS_ALREADY_RETRIED',
    });
  });

  it('counts nothing on a draft: its retry stays free', async () => {
    db.mediaObject.findUnique.mockResolvedValue(media({ published: false, status: MediaStatus.READY }));

    await reprocess(manage, 1);

    expect(db.mediaObject.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: MediaStatus.PROCESSING } }),
    );
  });
});
