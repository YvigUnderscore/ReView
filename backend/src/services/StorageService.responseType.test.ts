// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Type servi et durée de vie d'une lecture présignée (A4-05, A3-05).
 *
 * Deux invariants, tous deux tenus au seul endroit qui signe : le type de la réponse ne
 * vient JAMAIS du déposant (il se déduit de la clé, que le serveur a composée), et la durée
 * de vie par défaut n'est plus d'une heure pour tout le monde — elle vaut quinze minutes
 * pour un contenu consommé d'un bloc, l'heure historique pour un flux lu dans la durée.
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

import {
  storage,
  responseTypeFromKey,
  defaultGetTtl,
  DEFAULT_GET_TTL_SECONDS,
  STREAMED_GET_TTL_SECONDS,
  PRESIGN_WINDOW_SECONDS,
} from './StorageService';

/** Type imposé à la réponse par la dernière signature réellement calculée. */
const lastImposedType = () =>
  (signed.mock.calls.at(-1)![1] as { input: { ResponseContentType?: string } }).input.ResponseContentType;

/** Validité demandée au presigner lors de la dernière signature. */
const lastExpiresIn = () => (signed.mock.calls.at(-1)![2] as { expiresIn: number }).expiresIn;

let counter = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T10:03:20.000Z'));
  vi.clearAllMocks();
  counter = 0;
  send.mockResolvedValue({});
  signed.mockImplementation(() => Promise.resolve(`https://minio/signed/${++counter}`));
});

afterEach(() => vi.useRealTimers());

describe('responseTypeFromKey', () => {
  it('déduit le type des images que le serveur range lui-même', () => {
    expect(responseTypeFromKey('note-images/shot/12/1700-plan.png')).toBe('image/png');
    expect(responseTypeFromKey('entity-thumbs/shot/3.JPEG')).toBe('image/jpeg');
    expect(responseTypeFromKey('derived/42/thumbnail.webp')).toBe('image/webp');
  });

  it('rend opaque tout ce qui pourrait être interprété par le navigateur', () => {
    // Les trois formes que prend une XSS servie depuis l'origine de l'application.
    expect(responseTypeFromKey('entity-thumbs/department/7.svg')).toBe('application/octet-stream');
    expect(responseTypeFromKey('note-images/asset/1/x.html')).toBe('application/octet-stream');
    expect(responseTypeFromKey('note-images/asset/1/x.xml')).toBe('application/octet-stream');
  });

  it('rend opaque les formats VFX et les clés sans extension', () => {
    expect(responseTypeFromKey('hdri/studio.hdr')).toBe('application/octet-stream');
    expect(responseTypeFromKey('derived/1/model.glb')).toBe('application/octet-stream');
    expect(responseTypeFromKey('derived/1/splat-mask.bin')).toBe('application/octet-stream');
    expect(responseTypeFromKey('studio/ocio/abc.cube')).toBe('application/octet-stream');
    expect(responseTypeFromKey('projects/p/v/1/rush')).toBe('application/octet-stream');
    // Un point dans un dossier n'est pas une extension.
    expect(responseTypeFromKey('projects/p.v1/v/1/rush')).toBe('application/octet-stream');
  });

  it('conserve les types de flux réellement lus par le lecteur', () => {
    expect(responseTypeFromKey('derived/9/proxy.mp4')).toBe('video/mp4');
    expect(responseTypeFromKey('projects/p/v/1/plan.mov')).toBe('video/quicktime');
    expect(responseTypeFromKey('derived/9/hls/720p_003.ts')).toBe('video/mp2t');
  });
});

describe('getPresignedGetUrl — type imposé par défaut', () => {
  it('impose le type déduit de la clé pour une image de fiche déposée par PUT présigné', async () => {
    // Sans type imposé, l'objet était servi avec le `Content-Type` choisi par le déposant :
    // un PUT en `text/html` sur une clé `.png` sortait en `text/html`.
    await storage.getPresignedGetUrl('note-images/shot/12/1700-plan.png');
    expect(lastImposedType()).toBe('image/png');
  });

  it('impose un type opaque pour un HDRI, qu’aucun navigateur ne rend', async () => {
    await storage.getPresignedGetUrl('hdri/studio.hdr');
    expect(lastImposedType()).toBe('application/octet-stream');
  });

  it('impose un type opaque pour une vignette d’entité déposée en .svg', async () => {
    await storage.getPresignedGetUrl('entity-thumbs/shot/3.svg');
    expect(lastImposedType()).toBe('application/octet-stream');
  });

  it('laisse le type explicite de l’appelant prendre le pas, liste blanche comprise', async () => {
    await storage.getPresignedGetUrl('comments/1/piece.bin', 3600, 'application/pdf');
    expect(lastImposedType()).toBe('application/pdf');
    await storage.getPresignedGetUrl('comments/1/piece.bin', 3600, 'image/svg+xml');
    expect(lastImposedType()).toBe('application/octet-stream');
  });
});

describe('getPresignedGetUrl — durée de vie par défaut', () => {
  it('donne un quart d’heure à un contenu consommé d’un bloc', async () => {
    await storage.getPresignedGetUrl('derived/42/thumbnail.jpg');
    expect(DEFAULT_GET_TTL_SECONDS).toBe(900);
    expect(lastExpiresIn()).toBe(DEFAULT_GET_TTL_SECONDS + PRESIGN_WINDOW_SECONDS);
  });

  it('garde l’heure historique pour un flux lu dans la durée', async () => {
    // Un `<video src>` présigné redemande des tranches d'octets pendant toute la lecture :
    // raccourcir ici couperait la projection, pas la fuite.
    await storage.getPresignedGetUrl('derived/9/proxy.mp4');
    expect(lastExpiresIn()).toBe(STREAMED_GET_TTL_SECONDS + PRESIGN_WINDOW_SECONDS);
    expect(defaultGetTtl('derived/9/audio.mp3')).toBe(STREAMED_GET_TTL_SECONDS);
    expect(defaultGetTtl('derived/9/splat.spz')).toBe(DEFAULT_GET_TTL_SECONDS);
  });

  it('respecte toujours une durée explicitement demandée', async () => {
    await storage.getPresignedGetUrl('derived/9/thumbnail.jpg', 60);
    expect(lastExpiresIn()).toBe(60 + PRESIGN_WINDOW_SECONDS);
  });

  it('ne signe qu’une fois quand le défaut est redemandé explicitement', async () => {
    const implicite = await storage.getPresignedGetUrl('derived/43/thumbnail.jpg');
    const explicite = await storage.getPresignedGetUrl(
      'derived/43/thumbnail.jpg',
      DEFAULT_GET_TTL_SECONDS,
      'image/jpeg',
    );
    expect(explicite).toBe(implicite);
    expect(signed).toHaveBeenCalledTimes(1);
  });
});
