// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./apiClient', () => ({
  getToken: vi.fn(() => 'jeton'),
  api: { post: vi.fn(), get: vi.fn() },
}));
// Seul le point réseau est simulé : le pool, le réessai et l'annulation sont le vrai code.
vi.mock('./uploadTransfer', async (original) => ({
  ...(await original<typeof import('./uploadTransfer')>()),
  putWithProgress: vi.fn(),
}));

import { uploadImageSequence } from './sequenceUpload';
import { detectSequences } from './imageSequence';
import { api } from './apiClient';
import { putWithProgress, UploadHttpError } from './uploadTransfer';

/**
 * Envoi d'une séquence : N fichiers, UN média.
 *
 * Trois choses doivent tenir, parce que chacune coûte un plan entier quand elle lâche :
 * toutes les frames partent (pas seulement le premier lot), une reprise saute ce qui est
 * déjà arrivé, et une annulation libère les frames déjà déposées côté serveur.
 */

const post = vi.mocked(api.post);
const put = vi.mocked(putWithProgress);

const sequenceOf = (from: number, to: number) => {
  const files = Array.from(
    { length: to - from + 1 },
    (_, i) => ({ name: `plan.${String(from + i).padStart(4, '0')}.exr`, size: 1000 }) as unknown as File,
  );
  return detectSequences(files).sequences[0];
};

/** Route l'API de séquence ; `uploadedFrames` simule une reprise. */
function routeApi(uploadedFrames: string[] = []) {
  const urlRequests: string[][] = [];
  post.mockImplementation((path: string, body?: unknown) => {
    if (path === '/api/media/sequence/init')
      return Promise.resolve({
        mediaObjectId: 7,
        resumed: uploadedFrames.length > 0,
        uploadedFrames,
      } as never);
    if (path === '/api/media/sequence/7/urls') {
      const names = (body as { names: string[] }).names;
      urlRequests.push(names);
      return Promise.resolve({ urls: names.map((n) => ({ name: n, url: `https://s3/${n}` })) } as never);
    }
    if (path === '/api/media/sequence/7/complete')
      return Promise.resolve({
        media: { id: 7, status: 'PROCESSING' },
        frameCount: 100,
        missingFrames: 0,
      } as never);
    return Promise.resolve({} as never);
  });
  return urlRequests;
}

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue(null);
});

describe('uploadImageSequence', () => {
  it('déclare le motif et toutes les frames au serveur, en un seul média', async () => {
    routeApi();
    const res = await uploadImageSequence(sequenceOf(1001, 1010), 4);
    const init = post.mock.calls.find(([p]) => p === '/api/media/sequence/init')![1] as {
      pattern: string;
      frames: { name: string }[];
    };
    expect(init.pattern).toBe('plan.%04d.exr');
    expect(init.frames).toHaveLength(10);
    expect(res).toMatchObject({ mediaObjectId: 7, status: 'PROCESSING' });
  });

  it('envoie toutes les frames, par lots d’URLs successifs', async () => {
    const urlRequests = routeApi();
    await uploadImageSequence(sequenceOf(1001, 1100), 4);
    expect(put).toHaveBeenCalledTimes(100);
    // 100 frames par lots de 32 : quatre demandes d'URLs, la dernière partielle.
    expect(urlRequests.map((r) => r.length)).toEqual([32, 32, 32, 4]);
  });

  it('reprend un envoi interrompu sans renvoyer ce qui est déjà arrivé', async () => {
    routeApi(['plan.1001.exr', 'plan.1002.exr', 'plan.1003.exr']);
    await uploadImageSequence(sequenceOf(1001, 1010), 4);
    expect(put).toHaveBeenCalledTimes(7);
  });

  it('rend une progression en octets ET en fichiers', async () => {
    routeApi();
    const seen: { percent: number; files: number; totalFiles: number }[] = [];
    await uploadImageSequence(sequenceOf(1001, 1004), 4, {
      onProgress: (p) => seen.push({ percent: p.percent, files: p.files, totalFiles: p.totalFiles }),
    });
    expect(seen[0]).toEqual({ percent: 0, files: 0, totalFiles: 4 });
    expect(seen.at(-1)).toMatchObject({ files: 4, totalFiles: 4 });
    // Le pourcentage reste sous 100 tant que la finalisation serveur n'a pas répondu.
    expect(Math.max(...seen.map((s) => s.percent))).toBeLessThanOrEqual(99);
  });

  it('libère les frames déjà déposées quand l’envoi est annulé', async () => {
    routeApi();
    const ctrl = new AbortController();
    put.mockImplementation(async () => {
      ctrl.abort();
      return null;
    });
    await expect(uploadImageSequence(sequenceOf(1001, 1010), 4, { signal: ctrl.signal })).rejects.toThrow();
    expect(post.mock.calls.some(([p]) => p === '/api/media/multipart/7/abort')).toBe(true);
    expect(post.mock.calls.some(([p]) => p === '/api/media/sequence/7/complete')).toBe(false);
  });

  it('ne finalise pas quand une frame échoue définitivement', async () => {
    routeApi();
    // 400 : refus définitif, aucun réessai — un lot incomplet ne doit jamais être finalisé.
    put.mockRejectedValue(new UploadHttpError(400));
    await expect(uploadImageSequence(sequenceOf(1001, 1010), 4)).rejects.toThrow();
    expect(post.mock.calls.some(([p]) => p === '/api/media/sequence/7/complete')).toBe(false);
  });
});
