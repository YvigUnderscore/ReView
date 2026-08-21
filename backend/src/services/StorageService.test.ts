// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Faux client S3 : chaque commande garde son `input`, ce qui suffit à vérifier l'en-tête
 * réellement envoyé à MinIO — le seul objet de cette suite.
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
vi.mock('node:fs', () => ({
  createReadStream: vi.fn(() => 'flux-local'),
  createWriteStream: vi.fn(),
}));
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

import { storage } from './StorageService';

const lastInput = () => (send.mock.calls.at(-1)![0] as { input: Record<string, unknown> }).input;

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({});
  signed.mockResolvedValue('https://signed.example/x');
});

/**
 * Aucun chemin d'écriture ne stocke un type actif : les objets sont servis depuis l'origine
 * de l'application, un `text/html` y exécuterait du script avec la session de l'utilisateur.
 * `putObject` était le seul à ne pas passer par la liste blanche — et c'est par lui que
 * transitent les pièces jointes et les médias rapatriés d'un site ShotGrid.
 */
describe('StorageService — Content-Type des écritures serveur', () => {
  it('ramène un type actif sur application/octet-stream', async () => {
    await storage.putObject('comments/attachments/shotgrid/1/2-note.html', Buffer.from('x'), 'text/html');
    expect(lastInput().ContentType).toBe('application/octet-stream');

    await storage.putObject('a/b.svg', Buffer.from('x'), 'image/svg+xml');
    expect(lastInput().ContentType).toBe('application/octet-stream');
  });

  it('conserve les types de la liste blanche et retire les paramètres', async () => {
    await storage.putObject('derived/1/thumbnail.webp', Buffer.from('x'), 'image/webp');
    expect(lastInput().ContentType).toBe('image/webp');

    await storage.putObject('studio/ocio/x.ocio', Buffer.from('x'), 'text/plain; charset=utf-8');
    expect(lastInput().ContentType).toBe('text/plain');
  });

  it('couvre uploadFile, qui délègue à putObject', async () => {
    await storage.uploadFile('derived/1/model.glb', '/tmp/model.glb', 'text/html');
    expect(lastInput().Body).toBe('flux-local');
    expect(lastInput().ContentType).toBe('application/octet-stream');
  });

  it('normalise aussi la présignature d’upload et le multipart', async () => {
    await storage.getPresignedPutUrl('a/b.html', 'text/html');
    expect((signed.mock.calls.at(-1)![1] as { input: { ContentType: string } }).input.ContentType).toBe(
      'application/octet-stream',
    );

    await storage.createMultipartUpload('a/b.html', 'text/html');
    expect(lastInput().ContentType).toBe('application/octet-stream');
  });

  it('normalise le type imposé à la lecture', async () => {
    await storage.getPresignedGetUrl('a/b.svg', 60, 'image/svg+xml');
    const cmd = signed.mock.calls.at(-1)![1] as { input: { ResponseContentType?: string } };
    expect(cmd.input.ResponseContentType).toBe('application/octet-stream');
  });
});
