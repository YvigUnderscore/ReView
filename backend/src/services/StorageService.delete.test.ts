// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Faux client S3 : on compte les commandes envoyées et on relit leur `input`. La
 * suppression multiple se juge au NOMBRE d'allers-retours, pas au chronomètre.
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
    DeleteObjectCommand: class extends Command {},
    DeleteObjectsCommand: class extends Command {},
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
vi.mock('node:fs', () => ({ createReadStream: vi.fn(), createWriteStream: vi.fn() }));
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

import { storage, DELETE_OBJECTS_BATCH } from './StorageService';

type DeleteInput = { Bucket: string; Delete: { Objects: { Key: string }[] } };
const inputs = (): DeleteInput[] => send.mock.calls.map((call) => (call[0] as { input: DeleteInput }).input);

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({});
  signed.mockResolvedValue('https://signed.example/x');
});

describe('StorageService.deleteObjects — un appel pour mille clés', () => {
  it('400 clés : UN seul aller-retour, dans l’ordre reçu', async () => {
    const keys = Array.from({ length: 400 }, (_, index) => `derived/${index}/proxy.mp4`);

    await expect(storage.deleteObjects(keys)).resolves.toEqual([]);

    expect(send).toHaveBeenCalledTimes(1);
    const [first] = inputs();
    expect(first!.Bucket).toBe('review');
    expect(first!.Delete.Objects.map((o) => o.Key)).toEqual(keys);
  });

  it('découpe au plafond du protocole (1 000 clés par commande)', async () => {
    const keys = Array.from({ length: DELETE_OBJECTS_BATCH + 1 }, (_, index) => `k/${index}`);

    await storage.deleteObjects(keys);

    expect(send).toHaveBeenCalledTimes(2);
    const [first, second] = inputs();
    expect(first!.Delete.Objects).toHaveLength(DELETE_OBJECTS_BATCH);
    expect(second!.Delete.Objects).toHaveLength(1);
    expect(second!.Delete.Objects[0]!.Key).toBe(`k/${DELETE_OBJECTS_BATCH}`);
  });

  it('liste vide : aucun aller-retour', async () => {
    await expect(storage.deleteObjects([])).resolves.toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  /**
   * Une suppression partielle est un fait normal côté S3 : elle revient dans `Errors`, pas
   * en exception. L'appelant a besoin de la liste EXACTE pour n'enfiler que ces clés-là.
   */
  it('rend les clés refusées par le stockage, sans lever', async () => {
    send.mockResolvedValue({ Errors: [{ Key: 'k/2', Code: 'AccessDenied' }, { Code: 'NoKey' }] });

    await expect(storage.deleteObjects(['k/1', 'k/2'])).resolves.toEqual(['k/2']);
  });

  it('propage une panne de transport, comme deleteObject', async () => {
    send.mockRejectedValue(new Error('MinIO down'));
    await expect(storage.deleteObjects(['k/1'])).rejects.toThrow('MinIO down');
  });

  /**
   * Les URL présignées sont mémorisées par tranche de dix minutes. Une clé supprimée doit
   * sortir du cache, sinon une clé réécrite plus tard resservirait l'ancienne signature.
   * Le balayage est GROUPÉ : une passe pour tout le lot, pas une passe par clé.
   */
  it('oublie les URL présignées des clés supprimées', async () => {
    signed.mockResolvedValueOnce('https://signed.example/avant');
    const before = await storage.getPresignedGetUrl('derived/9/thumbnail.webp');
    expect(before).toBe('https://signed.example/avant');

    send.mockResolvedValue({});
    await storage.deleteObjects(['derived/9/thumbnail.webp']);

    signed.mockResolvedValueOnce('https://signed.example/apres');
    await expect(storage.getPresignedGetUrl('derived/9/thumbnail.webp')).resolves.toBe(
      'https://signed.example/apres',
    );
  });
});
