// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: {
    shotgridLink: { findUnique: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn() },
    version: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    mediaObject: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
  links: { mapSgToLocal: vi.fn(), removeLink: vi.fn(), upsertLink: vi.fn() },
  pull: { confirmGone: vi.fn(), noteUnknownStatus: vi.fn(), touch: vi.fn() },
  softDeleteVersion: vi.fn(),
  realignMediaNames: vi.fn(),
  resolveStorageContextForVersion: vi.fn(),
  uploadFile: vi.fn(),
  enqueueMediaJob: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: h.db }));
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/pipeline', () => ({ resolveStorageContextForVersion: h.resolveStorageContextForVersion }));
vi.mock('../../lib/storage', () => ({
  storage: { uploadFile: h.uploadFile },
  StorageService: {
    mediaKey: (a: { projectSlug: string; mediaId: number; filename: string }) =>
      `projects/${a.projectSlug}/${a.mediaId}/${a.filename}`,
  },
}));
vi.mock('../../lib/queues', () => ({ enqueueMediaJob: h.enqueueMediaJob }));
vi.mock('../../lib/trash', () => ({ softDeleteVersion: h.softDeleteVersion }));
vi.mock('./shotgridLinks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shotgridLinks')>()),
  ...h.links,
}));
vi.mock('./ShotgridMediaNaming', () => ({ realignMediaNames: h.realignMediaNames }));
vi.mock('./ShotgridPullService', () => h.pull);

import {
  importVersion,
  importVersionMedia,
  listImportableVersions,
  pullPublishedFiles,
  pullVersions,
} from './ShotgridVersionSync';

type Ctx = Parameters<typeof pullVersions>[0];
const PROJECT = { type: 'Project', id: 50 };

function makeCtx(
  overrides: { read?: boolean; media?: Record<string, unknown>; statusMap?: Record<string, number> } = {},
) {
  const client = { search: vi.fn().mockResolvedValue([]), downloadUrl: vi.fn(), openStream: vi.fn() };
  const journal = { log: vi.fn().mockResolvedValue(undefined), count: vi.fn() };
  const ctx = {
    connection: { id: 3 },
    scope: { sgProjectId: 50, sgProjectName: 'Film' },
    client,
    journal,
    settings: {
      domains: { versions: { read: overrides.read ?? true, write: false } },
      versionStatusMap: overrides.statusMap ?? {},
      media: {
        statusFilter: [],
        autoImport: true,
        source: 'transcoded',
        naming: 'code',
        maxSizeMo: 0,
        ...overrides.media,
      },
    },
  };
  return { ctx: ctx as unknown as Ctx, client, journal };
}

const version = (id: number, fields: Record<string, unknown> = {}) => ({
  type: 'Version',
  id,
  project: PROJECT,
  code: `v${id}`,
  sg_task: { type: 'Task', id: 70 },
  ...fields,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.links.mapSgToLocal.mockResolvedValue(new Map());
  h.pull.confirmGone.mockResolvedValue([]);
  h.db.shotgridLink.findUnique.mockResolvedValue(null);
  h.db.version.create.mockImplementation(async ({ data }) => ({ id: 100, ...data }));
  h.db.version.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
});

describe('pullVersions', () => {
  it('does nothing when reading versions is disabled', async () => {
    const { ctx, client } = makeCtx({ read: false });
    await pullVersions(ctx);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('filters by date and selection, and guards the project', async () => {
    const { ctx, client, journal } = makeCtx();
    client.search.mockResolvedValue([{ ...version(1), project: { type: 'Project', id: 99 } }]);
    await pullVersions(ctx, { since: new Date('2026-01-01T00:00:00Z'), onlySgIds: [1] });
    expect(client.search.mock.calls[0]![1].filters).toEqual([
      ['project', 'is', PROJECT],
      ['updated_at', 'greater_than', '2026-01-01T00:00:00.000Z'],
      ['id', 'in', [1]],
    ]);
    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
    expect(journal.log).toHaveBeenCalledWith(
      'error',
      'shotgrid.log.wrongProject',
      expect.objectContaining({ sgId: 1, found: 99 }),
      expect.anything(),
    );
  });

  it('a targeted pull trashes the versions the site no longer has', async () => {
    const { ctx, journal } = makeCtx();
    h.links.mapSgToLocal.mockResolvedValue(
      new Map([
        [5, { localId: 50 }],
        [6, { localId: 60 }],
        [7, { localId: 70 }],
      ]),
    );
    h.pull.confirmGone.mockResolvedValue([5, 6, 7, 8]);
    h.db.version.findUnique.mockImplementation(async ({ where }) =>
      where.id === 50
        ? { id: 50, deletedAt: null, taskId: 1, assetId: null }
        : where.id === 60
          ? { id: 60, deletedAt: new Date() }
          : null,
    );
    await pullVersions(ctx, { onlySgIds: [5, 6, 7, 8] });
    expect(h.softDeleteVersion).toHaveBeenCalledTimes(1);
    expect(h.softDeleteVersion).toHaveBeenCalledWith(50);
    expect(h.links.removeLink).toHaveBeenCalledWith(3, 'Version', 7);
    expect(journal.log).toHaveBeenCalledWith(
      'info',
      'shotgrid.log.trashedRemotely',
      expect.anything(),
      expect.anything(),
    );
    expect(h.pull.touch).toHaveBeenCalledWith(ctx, 'version', 50, { taskId: 1, assetId: null });
  });

  it('the status filter skips new versions but keeps following known ones', async () => {
    const { ctx, client, journal } = makeCtx({ media: { statusFilter: ['rev'] } });
    client.search.mockResolvedValue([
      version(1, { sg_status_list: 'apr' }),
      version(2, { sg_status_list: 'apr' }),
    ]);
    h.links.mapSgToLocal.mockResolvedValue(new Map([[2, { localId: 20, data: {} }]]));
    h.db.shotgridLink.findUnique.mockResolvedValue({ localId: 70 });
    h.db.version.findUnique.mockResolvedValue({ id: 20 });
    await pullVersions(ctx);
    expect(journal.count).toHaveBeenCalledWith('versions', 'skipped');
    expect(h.db.version.update).toHaveBeenCalledTimes(1);
    expect(h.db.version.create).not.toHaveBeenCalled();
  });

  it('a failing import is counted and journaled, the batch goes on', async () => {
    const { ctx, client, journal } = makeCtx();
    client.search.mockResolvedValue([version(1), version(2)]);
    h.db.shotgridLink.findUnique
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ localId: 70 });
    await pullVersions(ctx, { withMedia: false });
    expect(journal.count).toHaveBeenCalledWith('versions', 'failed');
    expect(journal.log).toHaveBeenCalledWith(
      'error',
      'shotgrid.log.versionImportFailed',
      { name: 'v1', error: 'db down' },
      { sgType: 'Version', sgId: 1 },
    );
    expect(h.db.version.create).toHaveBeenCalledTimes(1);
  });
});

describe('importVersion', () => {
  it('skips a version whose parent is unknown', async () => {
    const { ctx, journal } = makeCtx();
    await importVersion(ctx, version(1, { sg_task: null, entity: { type: 'Sequence', id: 4 } }), false);
    await importVersion(ctx, version(2, { sg_task: null, entity: null }), false);
    expect(journal.log).toHaveBeenCalledWith(
      'warn',
      'shotgrid.log.versionWithoutParent',
      { name: 'v1' },
      expect.anything(),
    );
    expect(h.db.version.create).not.toHaveBeenCalled();
  });

  it('files a version under its linked asset', async () => {
    const { ctx } = makeCtx();
    h.db.shotgridLink.findUnique.mockImplementation(async ({ where }) =>
      where.connectionId_sgType_sgId.sgType === 'Asset' ? { localId: 40 } : null,
    );
    await importVersion(ctx, version(1, { sg_task: null, entity: { type: 'Asset', id: 4 } }), false);
    expect(h.db.version.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: null, assetId: 40 }),
    });
  });

  it("opens the shot's catch-all task once, then reuses it", async () => {
    const { ctx, journal } = makeCtx();
    h.db.shotgridLink.findUnique.mockImplementation(async ({ where }) =>
      where.connectionId_sgType_sgId.sgType === 'Shot' ? { localId: 30 } : null,
    );
    h.db.task.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 81 });
    h.db.task.create.mockResolvedValue({ id: 80 });
    const record = version(1, { sg_task: null, entity: { type: 'Shot', id: 3, name: 'SH010' } });
    await importVersion(ctx, record, false);
    await importVersion(ctx, record, false);
    expect(h.db.task.create).toHaveBeenCalledTimes(1);
    expect(journal.log).toHaveBeenCalledWith(
      'info',
      'shotgrid.log.importTaskCreated',
      { shot: 'SH010' },
      expect.anything(),
    );
    expect(h.db.version.create.mock.calls.map((c) => c[0].data.taskId)).toEqual([80, 81]);
  });

  it('a shot without a link is not a parent', async () => {
    const { ctx } = makeCtx();
    await importVersion(ctx, version(1, { sg_task: null, entity: { type: 'Shot', id: 3 } }), false);
    expect(h.db.task.findFirst).not.toHaveBeenCalled();
  });

  it('writes the review decision only through an explicit status match', async () => {
    const { ctx } = makeCtx({ statusMap: { apr: 2 } });
    h.db.shotgridLink.findUnique.mockImplementation(async ({ where }) => {
      const t = where.connectionId_sgType_sgId.sgType;
      return t === 'Task' ? { localId: 70 } : t === 'HumanUser' ? { localId: 9 } : null;
    });
    await importVersion(
      ctx,
      version(1, { sg_status_list: 'apr', user: { type: 'HumanUser', id: 5 } }),
      false,
    );
    expect(h.db.version.create.mock.calls[0]![0].data).toMatchObject({
      reviewStatusId: 2,
      authorId: 9,
      published: true,
    });

    await importVersion(ctx, version(2, { sg_status_list: 'wtf' }), false);
    expect(h.db.version.create.mock.calls[1]![0].data).not.toHaveProperty('reviewStatusId');
    expect(h.pull.noteUnknownStatus).toHaveBeenCalledWith(ctx, 'version', 'wtf', 'v2');
  });

  it('updates a known version and keeps the link origin', async () => {
    const { ctx, journal } = makeCtx();
    h.db.shotgridLink.findUnique.mockResolvedValue({ localId: 70 });
    h.links.mapSgToLocal.mockResolvedValue(
      new Map([[1, { localId: 20, data: { mediaImported: true, createdFromReview: true } }]]),
    );
    h.db.version.findUnique.mockResolvedValue({ id: 20 });
    await importVersion(ctx, version(1, { sg_path_to_movie: '/mnt/v1.mov', sg_first_frame: 1001 }), true);
    expect(h.db.version.update).toHaveBeenCalledWith({ where: { id: 20 }, data: expect.anything() });
    expect(journal.count).toHaveBeenCalledWith('versions', 'updated');
    expect(h.realignMediaNames).toHaveBeenCalledWith(ctx, 20, 'v1');
    expect(h.links.upsertLink).toHaveBeenCalledTimes(1);
    expect(h.links.upsertLink.mock.calls[0]![0].data).toEqual({
      sgStatusCode: null,
      sgPathToMovie: '/mnt/v1.mov',
      sgFirstFrame: 1001,
      sgLastFrame: null,
      mediaImported: true,
      createdFromReview: true,
    });
  });

  it('a media failure does not undo the version', async () => {
    const { ctx, client, journal } = makeCtx();
    h.db.shotgridLink.findUnique.mockResolvedValue({ localId: 70 });
    client.downloadUrl.mockRejectedValue(new Error('expired'));
    await importVersion(ctx, version(1, { sg_uploaded_movie_mp4: { name: 'a.mp4' } }), true);
    expect(h.db.version.create).toHaveBeenCalled();
    expect(journal.count).toHaveBeenCalledWith('media', 'failed');
    expect(journal.log).toHaveBeenCalledWith(
      'warn',
      'shotgrid.log.mediaImportFailed',
      { name: 'v1', error: 'expired' },
      expect.anything(),
    );
  });

  it('marks the media as imported once transferred', async () => {
    const { ctx, client } = makeCtx();
    h.db.shotgridLink.findUnique.mockResolvedValue({ localId: 70 });
    client.downloadUrl.mockResolvedValue('https://s3/x');
    client.openStream.mockResolvedValue({
      stream: Readable.from([Buffer.from('abc')]),
      size: 3,
      type: 'video/mp4',
    });
    h.resolveStorageContextForVersion.mockResolvedValue({
      projectSlug: 'film',
      parentSegment: 's',
      versionName: 'v1',
    });
    h.db.mediaObject.create.mockResolvedValue({ id: 500 });
    h.db.mediaObject.update.mockResolvedValue({ id: 500, kind: 'VIDEO' });
    await importVersion(ctx, version(1, { sg_uploaded_movie_mp4: { name: 'a.mp4' } }), true);
    expect(h.links.upsertLink).toHaveBeenCalledTimes(2);
    expect(h.links.upsertLink.mock.calls[1]![0].data.mediaImported).toBe(true);
  });
});

describe('importVersionMedia', () => {
  const record = (fields: Record<string, unknown>) => version(1, fields);

  function streamOf(content: string, size?: number, type?: string) {
    return { stream: Readable.from([Buffer.from(content)]), size, type };
  }

  it('without a media field, says so and imports nothing', async () => {
    const { ctx, journal } = makeCtx();
    expect(await importVersionMedia(ctx, record({}), 100, 'v1')).toBe(false);
    expect(journal.log).toHaveBeenCalledWith(
      'info',
      'shotgrid.log.versionWithoutMedia',
      { name: 'v1' },
      expect.anything(),
    );
  });

  it('without any download URL, says so', async () => {
    const { ctx, client, journal } = makeCtx();
    client.downloadUrl.mockResolvedValue(null);
    expect(
      await importVersionMedia(ctx, record({ sg_uploaded_movie_mp4: { name: 'a.mp4' } }), 100, 'v1'),
    ).toBe(false);
    expect(journal.log).toHaveBeenCalledWith(
      'warn',
      'shotgrid.log.mediaUrlUnavailable',
      { name: 'v1', field: 'sg_uploaded_movie_mp4' },
      expect.anything(),
    );
  });

  it('refuses a media announced above the size limit, before any transfer', async () => {
    const { ctx, client, journal } = makeCtx({ media: { maxSizeMo: 1 } });
    client.downloadUrl.mockResolvedValue(null);
    const s = streamOf('x', 5 * 1024 * 1024);
    const destroy = vi.spyOn(s.stream, 'destroy');
    client.openStream.mockResolvedValue(s);
    const ok = await importVersionMedia(
      ctx,
      record({ sg_uploaded_movie_mp4: { url: 'https://s3/a' } }),
      100,
      'v1',
    );
    expect(ok).toBe(false);
    expect(destroy).toHaveBeenCalled();
    expect(journal.count).toHaveBeenCalledWith('media', 'skipped');
    expect(h.db.mediaObject.create).not.toHaveBeenCalled();
  });

  it('gives up when the version has no storage context', async () => {
    const { ctx, client } = makeCtx();
    client.downloadUrl.mockResolvedValue('https://s3/a');
    client.openStream.mockResolvedValue(streamOf('x'));
    h.resolveStorageContextForVersion.mockResolvedValue(null);
    expect(
      await importVersionMedia(ctx, record({ sg_uploaded_movie_mp4: { name: 'a.mp4' } }), 100, 'v1'),
    ).toBe(false);
  });

  it('refuses a media whose real size exceeds the limit, and removes the row', async () => {
    const { ctx, client, journal } = makeCtx({ media: { maxSizeMo: 1 } });
    client.downloadUrl.mockResolvedValue('https://s3/a');
    client.openStream.mockResolvedValue(streamOf('y'.repeat(1024 * 1024 + 1)));
    h.resolveStorageContextForVersion.mockResolvedValue({
      projectSlug: 'film',
      parentSegment: 's',
      versionName: 'v1',
    });
    h.db.mediaObject.create.mockResolvedValue({ id: 501 });
    expect(
      await importVersionMedia(ctx, record({ sg_uploaded_movie_mp4: { name: 'a.mp4' } }), 100, 'v1'),
    ).toBe(false);
    expect(h.db.mediaObject.delete).toHaveBeenCalledWith({ where: { id: 501 } });
    expect(journal.log).toHaveBeenCalledWith(
      'warn',
      'shotgrid.log.mediaTooLarge',
      expect.anything(),
      expect.anything(),
    );
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it('streams a video to storage, links its Attachment and queues the transcode', async () => {
    const { ctx, client, journal } = makeCtx();
    client.downloadUrl.mockResolvedValue('https://s3/a');
    client.openStream.mockResolvedValue(streamOf('frames', undefined, 'video/quicktime'));
    h.resolveStorageContextForVersion.mockResolvedValue({
      projectSlug: 'film',
      parentSegment: 's',
      versionName: 'v1',
    });
    h.db.mediaObject.create.mockImplementation(async ({ data }) => ({ id: 502, ...data }));
    h.db.mediaObject.update.mockImplementation(async ({ data }) => ({ id: 502, kind: 'VIDEO', ...data }));
    const value = { type: 'Attachment', id: 900, name: 'shot 010.mov' };
    expect(await importVersionMedia(ctx, record({ sg_uploaded_movie: value }), 100, 'SH010_v001')).toBe(true);

    const created = h.db.mediaObject.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({
      versionId: 100,
      kind: 'VIDEO',
      mimeType: 'video/quicktime',
      published: true,
    });
    expect(created.metadata).toMatchObject({
      importedFromShotgrid: true,
      sgVersionId: 1,
      sourceFilename: 'shot 010.mov',
    });
    expect(h.uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^projects\/film\/502\//),
      expect.any(String),
      'video/quicktime',
    );
    expect(h.db.mediaObject.update.mock.calls[0]![0].data).toMatchObject({ size: 6n, status: 'PROCESSING' });
    expect(h.links.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ localType: 'media', sgType: 'Attachment', sgId: 900 }),
    );
    expect(h.enqueueMediaJob).toHaveBeenCalledWith({ mediaObjectId: 502, kind: 'transcode' });
    expect(journal.count).toHaveBeenCalledWith('media', 'created');
  });

  it('an image keeps its file name on request, gets a thumbnail job and no link without an Attachment id', async () => {
    const { ctx, client } = makeCtx({ media: { naming: 'filename' } });
    client.downloadUrl.mockResolvedValue(null);
    client.openStream.mockResolvedValue(streamOf('png', 3, 'image/png'));
    h.resolveStorageContextForVersion.mockResolvedValue({
      projectSlug: 'film',
      parentSegment: 's',
      versionName: 'v1',
    });
    h.db.mediaObject.create.mockImplementation(async ({ data }) => ({ id: 503, ...data }));
    h.db.mediaObject.update.mockImplementation(async ({ data }) => ({ id: 503, kind: 'IMAGE', ...data }));
    const ok = await importVersionMedia(
      ctx,
      record({ sg_uploaded_movie_mp4: { attachment: { url: 'https://s3/still' }, name: 'still.png' } }),
      100,
      'v1',
    );
    expect(ok).toBe(true);
    expect(h.db.mediaObject.create.mock.calls[0]![0].data).toMatchObject({
      kind: 'IMAGE',
      originalName: 'still.png',
    });
    expect(client.openStream).toHaveBeenCalledWith('https://s3/still');
    expect(h.links.upsertLink).not.toHaveBeenCalled();
    expect(h.enqueueMediaJob).toHaveBeenCalledWith({ mediaObjectId: 503, kind: 'thumbnail' });
  });
});

describe('pullPublishedFiles', () => {
  it('does nothing when reading versions is disabled', async () => {
    const { ctx, client } = makeCtx({ read: false });
    await pullPublishedFiles(ctx);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('groups the publishes by version and stores them on the linked ones only', async () => {
    const { ctx, client, journal } = makeCtx();
    client.search.mockResolvedValue([
      {
        type: 'PublishedFile',
        id: 1,
        project: PROJECT,
        code: 'comp',
        path: { local_path: '/mnt/comp.exr' },
        version_number: 3,
        published_file_type: { type: 'PublishedFileType', id: 2, name: 'Image' },
        version: { type: 'Version', id: 10 },
      },
      { type: 'PublishedFile', id: 2, project: PROJECT, version: { type: 'Version', id: 10 } },
      { type: 'PublishedFile', id: 3, project: PROJECT, version: { type: 'Version', id: 11 } },
      { type: 'PublishedFile', id: 4, project: PROJECT },
      {
        type: 'PublishedFile',
        id: 5,
        project: { type: 'Project', id: 99 },
        version: { type: 'Version', id: 10 },
      },
    ]);
    h.db.shotgridLink.findUnique.mockImplementation(async ({ where }) =>
      where.connectionId_sgType_sgId.sgId === 10
        ? { localId: 20, sgUpdatedAt: null, data: { mediaImported: true } }
        : null,
    );
    await pullPublishedFiles(ctx);
    expect(h.links.upsertLink).toHaveBeenCalledTimes(1);
    expect(h.links.upsertLink.mock.calls[0]![0].data).toEqual({
      mediaImported: true,
      publishedFiles: [
        { id: 1, name: 'comp', path: '/mnt/comp.exr', type: 'Image', version: 3 },
        { id: 2, name: '#2', path: null, type: null, version: null },
      ],
    });
    expect(journal.count).toHaveBeenCalledWith('publishedFiles', 'updated');
  });
});

describe('listImportableVersions', () => {
  it('lists the project versions with their import state', async () => {
    const { ctx, client } = makeCtx();
    client.search.mockResolvedValue([
      version(1, {
        sg_status_list: 'rev',
        description: 'first pass',
        entity: { type: 'Shot', id: 3, name: 'SH010' },
        sg_task: { type: 'Task', id: 7, name: 'comp' },
        user: { type: 'HumanUser', id: 5, name: 'Ana' },
        sg_uploaded_movie_mp4: { name: 'a.mp4' },
        updated_at: '2026-02-01T10:00:00Z',
      }),
      version(2, { code: null, sg_task: null }),
      { ...version(3), project: { type: 'Project', id: 99 } },
    ]);
    h.links.mapSgToLocal.mockResolvedValue(new Map([[2, { localId: 20 }]]));
    const list = await listImportableVersions(ctx);
    expect(list).toEqual([
      {
        sgId: 1,
        code: 'v1',
        status: 'rev',
        description: 'first pass',
        entity: 'SH010',
        task: 'comp',
        user: 'Ana',
        hasMedia: true,
        imported: false,
        updatedAt: new Date('2026-02-01T10:00:00Z'),
      },
      expect.objectContaining({ sgId: 2, code: '#2', task: null, hasMedia: false, imported: true }),
    ]);
  });
});
