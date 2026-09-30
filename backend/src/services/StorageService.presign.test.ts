// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Mémoïsation des URL présignées de lecture.
 *
 * L'invariant tenu ici est celui du cache navigateur : à clé, type imposé et durée
 * identiques, deux appels rendent la MÊME chaîne pendant toute une tranche — sinon le
 * navigateur voit une URL neuve et retélécharge une vignette qu'il possède déjà. Le
 * corollaire, tout aussi important, est qu'une réécriture de l'objet casse cette stabilité :
 * une URL figée sur un contenu périmé serait une régression fonctionnelle, pas une
 * optimisation.
 */
const { send, signed } = vi.hoisted(() => ({ send: vi.fn(), signed: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = send;
    },
    CreateBucketCommand: Command,
    HeadBucketCommand: Command,
    PutObjectCommand: class extends Command {},
    GetObjectCommand: class extends Command {},
    HeadObjectCommand: Command,
    DeleteObjectCommand: Command,
    DeleteObjectsCommand: Command,
    ListObjectsV2Command: Command,
    PutBucketCorsCommand: Command,
    CreateMultipartUploadCommand: class extends Command {},
    UploadPartCommand: Command,
    CompleteMultipartUploadCommand: Command,
    AbortMultipartUploadCommand: Command,
    ListPartsCommand: Command,
    CopyObjectCommand: class extends Command {},
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: signed }));
vi.mock('node:fs', () => ({ createReadStream: vi.fn(() => 'flux'), createWriteStream: vi.fn() }));
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env', () => ({
  env: {
    S3_BUCKET: 'review',
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    CORS_ORIGIN: '*',
  },
}));

import { storage, PRESIGN_WINDOW_SECONDS, PRESIGN_CACHE_MAX } from './StorageService';

/** Options passées au presigner lors du dernier appel réellement signé. */
const lastSigningOptions = () => signed.mock.calls.at(-1)![2] as { expiresIn: number; signingDate: Date };

const THUMB = 'derived/42/thumbnail.jpg';

let counter = 0;

beforeEach(() => {
  vi.useFakeTimers();
  // Un instant arbitraire, volontairement décalé du début d'une tranche.
  vi.setSystemTime(new Date('2026-08-21T10:03:20.000Z'));
  vi.clearAllMocks();
  counter = 0;
  send.mockResolvedValue({});
  // Chaque signature rend une chaîne distincte : deux appels qui rendent la même valeur
  // prouvent donc la mémoïsation, et non un hasard de mock.
  signed.mockImplementation(() => Promise.resolve(`https://minio/signed/${++counter}`));
  // La tranche courante est repartie de zéro pour chaque test.
  storage.forgetPresignedUrl(THUMB);
});

afterEach(() => vi.useRealTimers());

describe('getPresignedGetUrl — stabilité de l’URL', () => {
  it('rend la même URL pour la même vignette dans la même tranche', async () => {
    const first = await storage.getPresignedGetUrl(THUMB);
    const second = await storage.getPresignedGetUrl(THUMB);
    expect(second).toBe(first);
    expect(signed).toHaveBeenCalledTimes(1);
  });

  it('mutualise deux demandes concurrentes de la même vignette', async () => {
    const [a, b] = await Promise.all([
      storage.getPresignedGetUrl('derived/7/thumbnail.jpg'),
      storage.getPresignedGetUrl('derived/7/thumbnail.jpg'),
    ]);
    expect(a).toBe(b);
    expect(signed).toHaveBeenCalledTimes(1);
  });

  it('épingle la date de signature au début de la tranche', async () => {
    // Deux processus (API et worker) qui signent au cours de la même tranche produisent
    // ainsi la même URL : le cache navigateur survit à un changement de backend.
    await storage.getPresignedGetUrl('derived/8/thumbnail.jpg');
    const { signingDate } = lastSigningOptions();
    expect(signingDate.getTime() % (PRESIGN_WINDOW_SECONDS * 1000)).toBe(0);
    expect(Date.now() - signingDate.getTime()).toBeLessThan(PRESIGN_WINDOW_SECONDS * 1000);
  });

  it('majore la validité de la largeur de tranche, pour ne jamais raccourcir un lien', async () => {
    // Une URL rendue à la toute fin d'une tranche doit rester valable aussi longtemps que
    // ce que l'appelant a demandé.
    await storage.getPresignedGetUrl('derived/9/thumbnail.jpg', 3600);
    const { expiresIn, signingDate } = lastSigningOptions();
    expect(expiresIn).toBe(3600 + PRESIGN_WINDOW_SECONDS);
    const endOfSlot = signingDate.getTime() + PRESIGN_WINDOW_SECONDS * 1000;
    expect(signingDate.getTime() + expiresIn * 1000 - endOfSlot).toBeGreaterThanOrEqual(3600 * 1000);
  });

  it('resigne à la tranche suivante', async () => {
    const before = await storage.getPresignedGetUrl(THUMB);
    vi.advanceTimersByTime(PRESIGN_WINDOW_SECONDS * 1000);
    const after = await storage.getPresignedGetUrl(THUMB);
    expect(after).not.toBe(before);
    expect(signed).toHaveBeenCalledTimes(2);
  });

  it('ne confond pas deux demandes qui ne portent pas le même contrat', async () => {
    const plain = await storage.getPresignedGetUrl('avatars/3.png');
    const typed = await storage.getPresignedGetUrl('avatars/3.png', 3600, 'image/png');
    const shortLived = await storage.getPresignedGetUrl('avatars/3.png', 60);
    const other = await storage.getPresignedGetUrl('avatars/4.png');
    expect(new Set([plain, typed, shortLived, other]).size).toBe(4);
  });

  it('conserve la normalisation du type imposé', async () => {
    await storage.getPresignedGetUrl('a/b.svg', 3600, 'image/svg+xml');
    const cmd = signed.mock.calls.at(-1)![1] as { input: { ResponseContentType?: string } };
    expect(cmd.input.ResponseContentType).toBe('application/octet-stream');
  });

  it('ne mémorise pas une signature en échec', async () => {
    signed.mockRejectedValueOnce(new Error('minio down'));
    await expect(storage.getPresignedGetUrl('derived/11/thumbnail.jpg')).rejects.toThrow('minio down');
    signed.mockImplementation(() => Promise.resolve('https://minio/ok'));
    await expect(storage.getPresignedGetUrl('derived/11/thumbnail.jpg')).resolves.toBe('https://minio/ok');
  });

  it('borne le nombre d’URL mémorisées', async () => {
    for (let i = 0; i < PRESIGN_CACHE_MAX + 1; i++) {
      await storage.getPresignedGetUrl(`derived/cap-${i}/thumbnail.jpg`);
    }
    const calls = signed.mock.calls.length;
    // La plus ancienne a été évincée (elle se resigne), la plus récente est toujours là.
    await storage.getPresignedGetUrl('derived/cap-0/thumbnail.jpg');
    expect(signed.mock.calls.length).toBe(calls + 1);
    await storage.getPresignedGetUrl(`derived/cap-${PRESIGN_CACHE_MAX}/thumbnail.jpg`);
    expect(signed.mock.calls.length).toBe(calls + 1);
  });
});

describe('getPresignedGetUrl — fraîcheur après réécriture', () => {
  it('oublie l’URL quand l’objet est réécrit sous la même clé', async () => {
    const before = await storage.getPresignedGetUrl(THUMB);
    await storage.putObject(THUMB, Buffer.from('x'), 'image/jpeg');
    expect(await storage.getPresignedGetUrl(THUMB)).not.toBe(before);
  });

  it('oublie aussi après uploadFile, copyObject et setObjectContentType', async () => {
    const uploaded = await storage.getPresignedGetUrl('derived/1/model.glb');
    await storage.uploadFile('derived/1/model.glb', '/tmp/model.glb', 'model/gltf-binary');
    expect(await storage.getPresignedGetUrl('derived/1/model.glb')).not.toBe(uploaded);

    const copied = await storage.getPresignedGetUrl('derived/2/copy.mp4');
    await storage.copyObject('derived/1/src.mp4', 'derived/2/copy.mp4');
    expect(await storage.getPresignedGetUrl('derived/2/copy.mp4')).not.toBe(copied);

    const typed = await storage.getPresignedGetUrl('projects/p/v/3/f.mov');
    await storage.setObjectContentType('projects/p/v/3/f.mov', 'video/quicktime');
    expect(await storage.getPresignedGetUrl('projects/p/v/3/f.mov')).not.toBe(typed);
  });

  it('oublie toutes les variantes d’une clé, quel que soit le type imposé', async () => {
    const plain = await storage.getPresignedGetUrl('avatars/5.png');
    const typed = await storage.getPresignedGetUrl('avatars/5.png', 3600, 'image/png');
    storage.forgetPresignedUrl('avatars/5.png');
    expect(await storage.getPresignedGetUrl('avatars/5.png')).not.toBe(plain);
    expect(await storage.getPresignedGetUrl('avatars/5.png', 3600, 'image/png')).not.toBe(typed);
  });

  it('oublie tout un préfixe à la suppression d’un média', async () => {
    const thumb = await storage.getPresignedGetUrl('derived/77/thumbnail.jpg');
    const mask = await storage.getPresignedGetUrl('derived/77/splat-mask.bin');
    const other = await storage.getPresignedGetUrl('derived/78/thumbnail.jpg');
    send.mockResolvedValue({ Contents: [{ Key: 'derived/77/thumbnail.jpg' }], IsTruncated: false });
    await storage.deletePrefix('derived/77/');
    expect(await storage.getPresignedGetUrl('derived/77/thumbnail.jpg')).not.toBe(thumb);
    expect(await storage.getPresignedGetUrl('derived/77/splat-mask.bin')).not.toBe(mask);
    // Le voisin, lui, n'a pas bougé.
    expect(await storage.getPresignedGetUrl('derived/78/thumbnail.jpg')).toBe(other);
  });

  it('oublie l’URL après un dépôt multipart terminé', async () => {
    const before = await storage.getPresignedGetUrl('projects/p/v/4/big.mov');
    await storage.completeMultipartUpload('projects/p/v/4/big.mov', 'upload-1', [
      { partNumber: 1, etag: 'e1' },
    ]);
    expect(await storage.getPresignedGetUrl('projects/p/v/4/big.mov')).not.toBe(before);
  });

  it('oublie l’URL à la suppression d’un objet isolé', async () => {
    const before = await storage.getPresignedGetUrl('avatars/9.png');
    await storage.deleteObject('avatars/9.png');
    expect(await storage.getPresignedGetUrl('avatars/9.png')).not.toBe(before);
  });
});
