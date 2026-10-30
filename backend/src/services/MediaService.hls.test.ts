// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../lib/prisma', () => ({ prisma: { mediaObject: { findUnique: vi.fn() } } }));
vi.mock('../lib/storage', () => ({
  storage: {
    getObjectBuffer: vi.fn(),
    getObjectStream: vi.fn(),
    getPresignedGetUrl: vi.fn(),
  },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../lib/queues', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/settings', () => ({ getNumericSetting: vi.fn(), SETTING_KEYS: {} }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForVersion: vi.fn(),
  resolveStorageContextForVersion: vi.fn(),
}));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));

import { getHlsFile, resetHlsPlaylistCache } from './MediaService';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { checkProjectAccess } from '../middleware/rbac';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { logMediaAccess } from '../lib/mediaAccess';
import { signMediaPlaybackToken } from '../lib/mediaToken';
import { Role } from '@prisma/client';

const findUnique = vi.mocked(prisma.mediaObject.findUnique);
const getObjectBuffer = vi.mocked(storage.getObjectBuffer);
const getObjectStream = vi.mocked(storage.getObjectStream);
const presign = vi.mocked(storage.getPresignedGetUrl);
const access = vi.mocked(checkProjectAccess);
const resolveProject = vi.mocked(resolveProjectIdForVersion);

const MEDIA_ID = 9;
const artist = { id: 3, role: Role.ARTIST };

const MASTER = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720', '720p.m3u8', ''].join('\n');
const RENDITION = ['#EXTM3U', '#EXTINF:2.0,', '720p_000.ts', '#EXT-X-ENDLIST', ''].join('\n');

/** The media exists, is published, and the player is a member of the project. */
function grantAccess(): void {
  findUnique.mockResolvedValue({ published: true, uploaderId: 99, versionId: 5 } as never);
  resolveProject.mockResolvedValue(11);
  access.mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHlsPlaylistCache();
  grantAccess();
  getObjectBuffer.mockImplementation(async (key: string) =>
    Buffer.from(key.endsWith('master.m3u8') ? MASTER : RENDITION, 'utf8'),
  );
  presign.mockImplementation(async (key: string) => `https://minio.test/review/${key}?X-Amz-Signature=abc`);
  getObjectStream.mockResolvedValue(Readable.from(['octets']));
});

describe('MediaService.getHlsFile: the master is the control point', () => {
  it('checks access in the database, logs, and attaches the token to each rendition', async () => {
    const out = await getHlsFile(artist, MEDIA_ID, 'master.m3u8', { ip: '10.0.0.1' });

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(access).toHaveBeenCalledTimes(1);
    expect(logMediaAccess).toHaveBeenCalledWith({ mediaObjectId: MEDIA_ID, userId: 3, ip: '10.0.0.1' });
    expect(out.contentType).toBe('application/vnd.apple.mpegurl');
    expect(out.cacheControl).toBe('private, no-store');
    expect(out.body).toMatch(/^720p\.m3u8\?pt=[\w.-]+$/m);
    // The master stays relative: no storage URL appears in it.
    expect(out.body).not.toContain('minio.test');
  });

  it('refuses a non-member of the project', async () => {
    access.mockResolvedValue(false);
    await expect(getHlsFile(artist, MEDIA_ID, 'master.m3u8')).rejects.toThrow(/No access/);
  });

  it("refuses another account's draft (not found, not forbidden)", async () => {
    findUnique.mockResolvedValue({ published: false, uploaderId: 99, versionId: 5 } as never);
    await expect(getHlsFile(artist, MEDIA_ID, 'master.m3u8')).rejects.toThrow(/not found/i);
  });

  it('refuses a file name that would compose another storage key', async () => {
    await expect(getHlsFile(artist, MEDIA_ID, '..')).rejects.toThrow(/not found/i);
    expect(getObjectBuffer).not.toHaveBeenCalled();
  });
});

describe('MediaService.getHlsFile: presigned sub-playlist', () => {
  const token = () => signMediaPlaybackToken(MEDIA_ID, artist.id);

  it('with a valid token: no database query, segments as absolute MinIO URLs', async () => {
    const out = await getHlsFile(artist, MEDIA_ID, '720p.m3u8', { playbackToken: token() });

    expect(findUnique).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(presign).toHaveBeenCalledWith('derived/9/hls/720p_000.ts', expect.any(Number));
    expect(out.body).toContain('https://minio.test/review/derived/9/hls/720p_000.ts?X-Amz-Signature=abc');
    expect(out.cacheControl).toBe('private, no-store');
  });

  it('without a token: the full check takes over (nothing breaks)', async () => {
    const out = await getHlsFile(artist, MEDIA_ID, '720p.m3u8');
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(out.body).toContain('https://minio.test/review/derived/9/hls/720p_000.ts');
  });

  it('with the token of ANOTHER media: full check, and refusal if access is missing', async () => {
    const foreign = signMediaPlaybackToken(MEDIA_ID + 1, artist.id);
    access.mockResolvedValue(false);
    await expect(getHlsFile(artist, MEDIA_ID, '720p.m3u8', { playbackToken: foreign })).rejects.toThrow(
      /No access/,
    );
  });

  it('with the token of ANOTHER account: full check', async () => {
    const foreign = signMediaPlaybackToken(MEDIA_ID, artist.id + 1);
    await getHlsFile(artist, MEDIA_ID, '720p.m3u8', { playbackToken: foreign });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('freezes the playlist per window: two players receive the same URLs, signed once', async () => {
    const first = await getHlsFile(artist, MEDIA_ID, '720p.m3u8', { playbackToken: token() });
    const other = { id: 4, role: Role.ARTIST };
    const second = await getHlsFile(other, MEDIA_ID, '720p.m3u8', {
      playbackToken: signMediaPlaybackToken(MEDIA_ID, other.id),
    });

    expect(second.body).toBe(first.body);
    expect(presign).toHaveBeenCalledTimes(1);
    expect(getObjectBuffer).toHaveBeenCalledTimes(1);
  });
});

describe('MediaService.getHlsFile: segment fallback through the proxy', () => {
  it('remains served, and becomes cacheable indefinitely (immutable content)', async () => {
    const out = await getHlsFile(artist, MEDIA_ID, '720p_000.ts', {
      playbackToken: signMediaPlaybackToken(MEDIA_ID, artist.id),
    });
    expect(out.stream).toBeInstanceOf(Readable);
    expect(out.contentType).toBe('video/mp2t');
    expect(out.cacheControl).toBe('private, max-age=31536000, immutable');
  });

  it('returns 404 when the segment is absent from storage', async () => {
    getObjectStream.mockRejectedValue(new Error('NoSuchKey'));
    await expect(getHlsFile(artist, MEDIA_ID, '720p_999.ts')).rejects.toThrow(/not found/i);
  });
});
