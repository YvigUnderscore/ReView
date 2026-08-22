// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Le hachage est vérifié par hashFile.test : ici il ne doit surtout pas coûter 20 Go de lecture.
vi.mock('./hashFile', () => ({ sha256OfFile: vi.fn().mockResolvedValue('a'.repeat(64)) }));
vi.mock('./apiClient', () => ({
  getToken: vi.fn(() => 'jeton'),
  api: { post: vi.fn(), get: vi.fn() },
}));
// `putWithProgress` est le seul point réseau simulé : le reste (réessai, pool, annulation)
// est le code réel, c'est justement lui qu'on veut éprouver.
vi.mock('./uploadTransfer', async (original) => ({
  ...(await original<typeof import('./uploadTransfer')>()),
  putWithProgress: vi.fn(),
}));

import { inferMediaKind, uploadMedia } from './uploadClient';
import { api, getToken } from './apiClient';
import { putWithProgress } from './uploadTransfer';

const post = vi.mocked(api.post);
const put = vi.mocked(putWithProgress);
const token = vi.mocked(getToken);

const MB = 1024 * 1024;
const f = (name: string, type = '') => new File(['x'], name, { type });

/** Fichier factice : seules la taille et le découpage comptent pour le moteur d'envoi. */
function bigFile(size: number, name = 'master.mov'): { file: File; slices: [number, number][] } {
  const slices: [number, number][] = [];
  const file = {
    name,
    size,
    type: 'video/quicktime',
    slice: (start: number, end: number) => {
      slices.push([start, end]);
      return new Blob(['p']);
    },
  } as unknown as File;
  return { file, slices };
}

/** Router de l'API d'upload : init multipart, URLs de parts, complete, finalize. */
function routeApi(options: { uploadedParts?: { partNumber: number; etag: string }[] } = {}) {
  const partRequests: number[][] = [];
  post.mockImplementation((path: string, body?: unknown) => {
    if (path === '/api/media/multipart/init')
      return Promise.resolve({
        mediaObjectId: 7,
        partSize: 16 * MB,
        uploadedParts: options.uploadedParts ?? [],
      } as never);
    if (path === '/api/media/multipart/7/parts') {
      const numbers = (body as { partNumbers: number[] }).partNumbers;
      partRequests.push(numbers);
      return Promise.resolve({
        urls: numbers.map((n) => ({ partNumber: n, url: `https://s3/p${n}` })),
      } as never);
    }
    if (path === '/api/media/upload-url')
      return Promise.resolve({
        mediaObjectId: 7,
        uploadUrl: 'https://s3/direct',
        namingWarning: true,
      } as never);
    if (path === '/api/media/7/finalize')
      return Promise.resolve({ media: { status: 'PROCESSING' } } as never);
    return Promise.resolve({} as never);
  });
  return partRequests;
}

const completedParts = () =>
  (post.mock.calls.find(([p]) => p === '/api/media/multipart/7/complete')?.[1] as {
    parts: { partNumber: number; etag: string }[];
  }) ?? null;

/** Laisse le moteur avancer d'un tour complet de boucle d'événements. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  token.mockReturnValue('jeton');
  put.mockResolvedValue('"etag"');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('inferMediaKind', () => {
  it('reconnaît les modèles 3D par extension (prioritaire sur le MIME)', () => {
    expect(inferMediaKind(f('scene.glb'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('Scene.GLTF'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('rig.fbx', 'application/octet-stream'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('archive.zip', 'application/zip'))).toBe('MODEL_3D');
  });

  it('reconnaît toutes les déclinaisons USD (45.F)', () => {
    // `.usd` n'était pas listé : il n'arrivait en MODEL_3D que par le repli final.
    expect(inferMediaKind(f('scene.usd'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('asset.usda'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('asset.usdc'))).toBe('MODEL_3D');
    expect(inferMediaKind(f('PACK.USDZ'))).toBe('MODEL_3D');
  });

  it('reconnaît les Gaussian Splats par extension (viewer Spark)', () => {
    expect(inferMediaKind(f('scan.ply'))).toBe('SPLAT');
    expect(inferMediaKind(f('scene.spz'))).toBe('SPLAT');
    expect(inferMediaKind(f('cloud.splat'))).toBe('SPLAT');
    expect(inferMediaKind(f('big.ksplat'))).toBe('SPLAT');
    expect(inferMediaKind(f('compressed.SOG'))).toBe('SPLAT');
  });

  it('reconnaît vidéo et image par type MIME', () => {
    expect(inferMediaKind(f('plan.mp4', 'video/mp4'))).toBe('VIDEO');
    expect(inferMediaKind(f('ref.png', 'image/png'))).toBe('IMAGE');
  });

  it('repli MODEL_3D pour les types inconnus', () => {
    expect(inferMediaKind(f('donnees.bin', 'application/octet-stream'))).toBe('MODEL_3D');
  });
});

describe('uploadMedia — petit fichier', () => {
  it('refuse de démarrer sans token (aucun appel réseau)', async () => {
    token.mockReturnValue(null);
    await expect(uploadMedia(f('a.png', 'image/png'), 1)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('fait un seul PUT présigné, puis finalize, et remonte l’avertissement de nommage', async () => {
    routeApi();
    const pct: number[] = [];
    const res = await uploadMedia(f('ref.png', 'image/png'), 4, { onProgress: (p) => pct.push(p) });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe('https://s3/direct');
    expect(res).toEqual({ mediaObjectId: 7, status: 'PROCESSING', namingWarning: true });
    expect(pct.at(-1)).toBe(100);
    expect(post).toHaveBeenCalledWith('/api/media/7/finalize');
  });
});

describe('uploadMedia — multipart', () => {
  it('découpe le fichier et envoie chaque part une seule fois', async () => {
    routeApi();
    const { file, slices } = bigFile(40 * MB);
    put.mockImplementation((url) => Promise.resolve(`"etag-${url.slice(-1)}"`));

    const res = await uploadMedia(file, 4);

    expect(put).toHaveBeenCalledTimes(3);
    expect(slices).toEqual([
      [0, 16 * MB],
      [16 * MB, 32 * MB],
      [32 * MB, 40 * MB],
    ]);
    // Les guillemets de l'ETag S3 sont retirés avant `complete`.
    expect(completedParts()?.parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ]);
    expect(res.mediaObjectId).toBe(7);
  });

  it('ne renvoie pas les parts déjà reçues à la reprise', async () => {
    routeApi({ uploadedParts: [{ partNumber: 1, etag: 'deja' }] });
    const { file } = bigFile(40 * MB);

    await uploadMedia(file, 4);

    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.map((c) => c[0])).toEqual(['https://s3/p2', 'https://s3/p3']);
    expect(completedParts()?.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });

  it('envoie quatre parts de front, pas une par une', async () => {
    routeApi();
    const { file } = bigFile(128 * MB); // 8 parts
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    put.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<string>((resolve) =>
        release.push(() => {
          inFlight -= 1;
          resolve('"e"');
        }),
      );
    });

    const run = uploadMedia(file, 4);
    // Laisse le pool se remplir avant de libérer quoi que ce soit.
    await tick();
    expect(release).toHaveLength(4); // quatre parts de front, pas huit, pas une
    while (release.length > 0) {
      release.splice(0).forEach((fn) => fn());
      await tick();
    }
    await run;
    expect(peak).toBe(4);
    expect(put).toHaveBeenCalledTimes(8);
  });

  it('réessaie une part en échec avec une URL fraîche, sans perdre les autres', async () => {
    const partRequests = routeApi();
    const { file } = bigFile(40 * MB);
    let firstAttempt = true;
    put.mockImplementation((url) => {
      if (firstAttempt && url === 'https://s3/p2') {
        firstAttempt = false;
        return Promise.reject(new Error('coupure réseau'));
      }
      return Promise.resolve('"e"');
    });

    await expect(uploadMedia(file, 4)).resolves.toMatchObject({ mediaObjectId: 7 });
    // Un lot de trois parts, puis une re-signature ciblée de la seule part rejouée.
    expect(partRequests).toEqual([[1, 2, 3], [2]]);
    expect(completedParts()?.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });

  it('remonte l’échec quand une part ne passe pas malgré les réessais', async () => {
    routeApi();
    const { file } = bigFile(40 * MB);
    put.mockRejectedValue(new Error('stockage injoignable'));
    vi.useFakeTimers();
    const outcome = uploadMedia(file, 4).then(
      () => 'réussi',
      (err: Error) => err.message,
    );
    await vi.advanceTimersByTimeAsync(30_000); // trois attentes progressives épuisées
    expect(await outcome).toBe('stockage injoignable');
    expect(completedParts()).toBeNull();
  });
});

describe('uploadMedia — annulation', () => {
  it('n’envoie rien si le signal est déjà déclenché', async () => {
    routeApi();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(uploadMedia(bigFile(40 * MB).file, 4, { signal: ctrl.signal })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('abandonne le multipart côté serveur quand l’envoi est coupé en cours', async () => {
    routeApi();
    const ctrl = new AbortController();
    const { file } = bigFile(40 * MB);
    put.mockImplementation(() => {
      ctrl.abort();
      return Promise.reject(new Error('coupé'));
    });

    await expect(uploadMedia(file, 4, { signal: ctrl.signal })).rejects.toThrow();
    // Les parts déjà déposées cessent d'être facturées ; le média UPLOADING disparaît.
    expect(post).toHaveBeenCalledWith('/api/media/multipart/7/abort');
    expect(completedParts()).toBeNull();
  });
});
