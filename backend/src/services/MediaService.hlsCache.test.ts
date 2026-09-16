// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { getHlsFile, resetHlsPlaylistCache, __hlsCacheTesting } from './MediaService';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { checkProjectAccess } from '../middleware/rbac';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { Role } from '@prisma/client';

const findUnique = vi.mocked(prisma.mediaObject.findUnique);
const getObjectBuffer = vi.mocked(storage.getObjectBuffer);
const presign = vi.mocked(storage.getPresignedGetUrl);
const access = vi.mocked(checkProjectAccess);
const resolveProject = vi.mocked(resolveProjectIdForVersion);

const artist = { id: 3, role: Role.ARTIST };

/** Sous-playlist de 27 segments de 2 s — la forme mesurée sur la pile de développement. */
const RENDITION = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:2',
  ...Array.from({ length: 27 }, (_, i) => [
    `#EXTINF:2.000000,`,
    `360p_${String(i).padStart(3, '0')}.ts`,
  ]).flat(),
  '#EXT-X-ENDLIST',
  '',
].join('\n');

/** Lit une rendition en passant le contrôle d'accès complet. */
const read = (id: number, file: string): Promise<string> => getHlsFile(artist, id, file).then((r) => r.body!);

beforeEach(() => {
  vi.clearAllMocks();
  resetHlsPlaylistCache();
  findUnique.mockResolvedValue({ published: true, uploaderId: 99, versionId: 5 } as never);
  resolveProject.mockResolvedValue(11);
  access.mockResolvedValue(true);
  getObjectBuffer.mockImplementation(async (key: string) => {
    // Un aller-retour MinIO réel n'est pas instantané : sans ce report, deux appels
    // « simultanés » ne le seraient pas vraiment et le test ne prouverait rien.
    await new Promise((r) => setImmediate(r));
    return Buffer.from(RENDITION.replace(/360p_/g, `${key.split('/').pop()!.split('.')[0]}_`), 'utf8');
  });
  presign.mockImplementation(async (key: string) => `https://minio/${key}?X-Amz-Signature=deadbeef`);
});

describe('presignedRendition — vingt spectateurs simultanés, une seule lecture (PERF-12)', () => {
  it('vingt demandes concurrentes de la même rendition ne font qu’un aller-retour MinIO', async () => {
    const bodies = await Promise.all(Array.from({ length: 20 }, () => read(9, '360p.m3u8')));

    // Le cache mémorisait le TEXTE, donc seulement après résolution : vingt spectateurs
    // arrivés ensemble manquaient tous le cache. Il mémorise désormais la promesse.
    expect(getObjectBuffer).toHaveBeenCalledTimes(1);
    expect(presign).toHaveBeenCalledTimes(27); // 27 segments, signés une seule fois
    // Et tout le monde reçoit exactement la même playlist.
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('X-Amz-Signature=deadbeef');
  });

  it('un échec de lecture ne se mémorise pas : la demande suivante réessaie', async () => {
    getObjectBuffer.mockRejectedValueOnce(new Error('MinIO down'));
    await expect(read(9, '360p.m3u8')).rejects.toThrow();
    expect(__hlsCacheTesting.stats().entries).toBe(0);
    await expect(read(9, '360p.m3u8')).resolves.toContain('#EXTM3U');
    expect(getObjectBuffer).toHaveBeenCalledTimes(2);
  });
});

describe('presignedRendition — une salle de dailies tient dans le cache (PERF-12)', () => {
  it('quinze plans × 3 renditions restent tous en cache après un tour de playlist', async () => {
    const playlist = Array.from({ length: 15 }, (_, i) => i + 1);
    const renditions = ['360p.m3u8', '720p.m3u8', '1080p.m3u8'];
    for (const id of playlist) for (const f of renditions) await read(id, f);
    expect(getObjectBuffer).toHaveBeenCalledTimes(45);
    expect(__hlsCacheTesting.stats().entries).toBe(45);

    // Retour en arrière dans la playlist : AUCUNE relecture. Avec l'ancien plafond de 32,
    // les treize premiers plans avaient déjà été évincés par les suivants.
    for (const id of playlist) for (const f of renditions) await read(id, f);
    expect(getObjectBuffer).toHaveBeenCalledTimes(45);
  });

  it('les deux plafonds tiennent : entrées bornées, octets comptés', async () => {
    const body = await read(1, '360p.m3u8');
    expect(__hlsCacheTesting.stats()).toEqual({ entries: 1, bytes: Buffer.byteLength(body, 'utf8') });

    for (let id = 2; id <= __hlsCacheTesting.RENDITION_CACHE_MAX + 50; id += 1) await read(id, '360p.m3u8');
    const stats = __hlsCacheTesting.stats();
    expect(stats.entries).toBe(__hlsCacheTesting.RENDITION_CACHE_MAX);
    expect(stats.bytes).toBeLessThanOrEqual(__hlsCacheTesting.RENDITION_CACHE_MAX_BYTES);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('éviction LRU : relire une entrée la rajeunit (la FIFO évinçait celle qu’on venait de servir)', async () => {
    const max = __hlsCacheTesting.RENDITION_CACHE_MAX;
    for (let id = 1; id <= max; id += 1) await read(id, '360p.m3u8'); // cache plein
    await read(1, '360p.m3u8'); // relecture : 1 redevient la plus récente
    const before = getObjectBuffer.mock.calls.length;

    await read(max + 1, '360p.m3u8'); // une entrée de plus ⇒ une éviction

    await read(1, '360p.m3u8'); // toujours là (rajeunie)
    expect(getObjectBuffer).toHaveBeenCalledTimes(before + 1);
    await read(2, '360p.m3u8'); // c'est 2, la plus anciennement lue, qui est partie
    expect(getObjectBuffer).toHaveBeenCalledTimes(before + 2);
  });
});
