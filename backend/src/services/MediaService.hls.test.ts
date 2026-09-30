// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../lib/prisma', () => ({ prisma: { mediaObject: { findUnique: vi.fn() } } }));
vi.mock('./StorageService', () => ({
  storage: {
    getObjectBuffer: vi.fn(),
    getObjectStream: vi.fn(),
    getPresignedGetUrl: vi.fn(),
  },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('./JobService', () => ({ enqueueMediaJob: vi.fn() }));
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
import { storage } from './StorageService';
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

/** Le média existe, il est publié, et le lecteur est membre du projet. */
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

describe('MediaService.getHlsFile — le maître est le point de contrôle', () => {
  it('vérifie l’accès en base, journalise, et accroche le jeton à chaque rendition', async () => {
    const out = await getHlsFile(artist, MEDIA_ID, 'master.m3u8', { ip: '10.0.0.1' });

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(access).toHaveBeenCalledTimes(1);
    expect(logMediaAccess).toHaveBeenCalledWith({ mediaObjectId: MEDIA_ID, userId: 3, ip: '10.0.0.1' });
    expect(out.contentType).toBe('application/vnd.apple.mpegurl');
    expect(out.cacheControl).toBe('private, no-store');
    expect(out.body).toMatch(/^720p\.m3u8\?pt=[\w.-]+$/m);
    // Le maître reste relatif : aucune URL de stockage n'y figure.
    expect(out.body).not.toContain('minio.test');
  });

  it('refuse un non-membre du projet', async () => {
    access.mockResolvedValue(false);
    await expect(getHlsFile(artist, MEDIA_ID, 'master.m3u8')).rejects.toThrow(/No access/);
  });

  it("refuse le brouillon d'un autre compte (introuvable, pas interdit)", async () => {
    findUnique.mockResolvedValue({ published: false, uploaderId: 99, versionId: 5 } as never);
    await expect(getHlsFile(artist, MEDIA_ID, 'master.m3u8')).rejects.toThrow(/not found/i);
  });

  it('refuse un nom de fichier qui composerait une autre clé de stockage', async () => {
    await expect(getHlsFile(artist, MEDIA_ID, '..')).rejects.toThrow(/not found/i);
    expect(getObjectBuffer).not.toHaveBeenCalled();
  });
});

describe('MediaService.getHlsFile — sous-playlist présignée', () => {
  const token = () => signMediaPlaybackToken(MEDIA_ID, artist.id);

  it('avec un jeton valide : aucune requête base, segments en URL MinIO absolues', async () => {
    const out = await getHlsFile(artist, MEDIA_ID, '720p.m3u8', { playbackToken: token() });

    expect(findUnique).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(presign).toHaveBeenCalledWith('derived/9/hls/720p_000.ts', expect.any(Number));
    expect(out.body).toContain('https://minio.test/review/derived/9/hls/720p_000.ts?X-Amz-Signature=abc');
    expect(out.cacheControl).toBe('private, no-store');
  });

  it('sans jeton : le contrôle complet reprend la main (rien ne casse)', async () => {
    const out = await getHlsFile(artist, MEDIA_ID, '720p.m3u8');
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(out.body).toContain('https://minio.test/review/derived/9/hls/720p_000.ts');
  });

  it('avec le jeton d’un AUTRE média : contrôle complet, et refus si l’accès manque', async () => {
    const foreign = signMediaPlaybackToken(MEDIA_ID + 1, artist.id);
    access.mockResolvedValue(false);
    await expect(getHlsFile(artist, MEDIA_ID, '720p.m3u8', { playbackToken: foreign })).rejects.toThrow(
      /No access/,
    );
  });

  it('avec le jeton d’un AUTRE compte : contrôle complet', async () => {
    const foreign = signMediaPlaybackToken(MEDIA_ID, artist.id + 1);
    await getHlsFile(artist, MEDIA_ID, '720p.m3u8', { playbackToken: foreign });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('gèle la playlist par fenêtre : deux lecteurs reçoivent les mêmes URL, signées une fois', async () => {
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

describe('MediaService.getHlsFile — repli segment par le proxy', () => {
  it('reste servi, et devient cachable indéfiniment (contenu immuable)', async () => {
    const out = await getHlsFile(artist, MEDIA_ID, '720p_000.ts', {
      playbackToken: signMediaPlaybackToken(MEDIA_ID, artist.id),
    });
    expect(out.stream).toBeInstanceOf(Readable);
    expect(out.contentType).toBe('video/mp2t');
    expect(out.cacheControl).toBe('private, max-age=31536000, immutable');
  });

  it('rend 404 quand le segment est absent du stockage', async () => {
    getObjectStream.mockRejectedValue(new Error('NoSuchKey'));
    await expect(getHlsFile(artist, MEDIA_ID, '720p_999.ts')).rejects.toThrow(/not found/i);
  });
});
