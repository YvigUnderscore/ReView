// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Served type and lifetime of a presigned read (A4-05, A3-05).
 *
 * Two invariants, both held in the only place that signs: the response type NEVER comes from the uploader
 * (it is derived from the key, which the server composes), and the default lifetime is no longer one hour for
 * everyone: it is fifteen minutes for content consumed in one block, the historical hour for a stream read over time.
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

/** Type forced on the response by the last signature actually computed. */
const lastImposedType = () =>
  (signed.mock.calls.at(-1)![1] as { input: { ResponseContentType?: string } }).input.ResponseContentType;

/** Validity requested from the presigner on the last signature. */
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
  it('derives the type of the images the server files itself', () => {
    expect(responseTypeFromKey('note-images/shot/12/1700-plan.png')).toBe('image/png');
    expect(responseTypeFromKey('entity-thumbs/shot/3.JPEG')).toBe('image/jpeg');
    expect(responseTypeFromKey('derived/42/thumbnail.webp')).toBe('image/webp');
  });

  it('makes opaque anything the browser could interpret', () => {
        // The three forms an XSS takes when served from the application's origin.
    expect(responseTypeFromKey('entity-thumbs/department/7.svg')).toBe('application/octet-stream');
    expect(responseTypeFromKey('note-images/asset/1/x.html')).toBe('application/octet-stream');
    expect(responseTypeFromKey('note-images/asset/1/x.xml')).toBe('application/octet-stream');
  });

  it('makes VFX formats and keys without extension opaque', () => {
    expect(responseTypeFromKey('hdri/studio.hdr')).toBe('application/octet-stream');
    expect(responseTypeFromKey('derived/1/model.glb')).toBe('application/octet-stream');
    expect(responseTypeFromKey('derived/1/splat-mask.bin')).toBe('application/octet-stream');
    expect(responseTypeFromKey('studio/ocio/abc.cube')).toBe('application/octet-stream');
    expect(responseTypeFromKey('projects/p/v/1/rush')).toBe('application/octet-stream');
        // A dot in a folder is not an extension.
    expect(responseTypeFromKey('projects/p.v1/v/1/rush')).toBe('application/octet-stream');
  });

  it('keeps the stream types the player actually reads', () => {
    expect(responseTypeFromKey('derived/9/proxy.mp4')).toBe('video/mp4');
    expect(responseTypeFromKey('projects/p/v/1/plan.mov')).toBe('video/quicktime');
    expect(responseTypeFromKey('derived/9/hls/720p_003.ts')).toBe('video/mp2t');
  });
});

describe('getPresignedGetUrl: forced type by default', () => {
  it('forces the type derived from the key for a sheet image uploaded by presigned PUT', async () => {
        // Without a forced type, the object was served with the `Content-Type` chosen by the uploader:
        // a PUT as `text/html` on a `.png` key came out as `text/html`.
    await storage.getPresignedGetUrl('note-images/shot/12/1700-plan.png');
    expect(lastImposedType()).toBe('image/png');
  });

  it('forces an opaque type for an HDRI, which no browser renders', async () => {
    await storage.getPresignedGetUrl('hdri/studio.hdr');
    expect(lastImposedType()).toBe('application/octet-stream');
  });

  it('forces an opaque type for an entity thumbnail uploaded as .svg', async () => {
    await storage.getPresignedGetUrl('entity-thumbs/shot/3.svg');
    expect(lastImposedType()).toBe('application/octet-stream');
  });

  it('lets the caller\'s explicit type take precedence, allowlist included', async () => {
    await storage.getPresignedGetUrl('comments/1/piece.bin', 3600, 'application/pdf');
    expect(lastImposedType()).toBe('application/pdf');
    await storage.getPresignedGetUrl('comments/1/piece.bin', 3600, 'image/svg+xml');
    expect(lastImposedType()).toBe('application/octet-stream');
  });
});

describe('getPresignedGetUrl: default lifetime', () => {
  it('gives a quarter of an hour to content consumed in one block', async () => {
    await storage.getPresignedGetUrl('derived/42/thumbnail.jpg');
    expect(DEFAULT_GET_TTL_SECONDS).toBe(900);
    expect(lastExpiresIn()).toBe(DEFAULT_GET_TTL_SECONDS + PRESIGN_WINDOW_SECONDS);
  });

  it('keeps the historical hour for a stream read over time', async () => {
        // A presigned `<video src>` keeps requesting byte ranges for the whole playback: shortening it here
        // would cut the projection, not the leak.
    await storage.getPresignedGetUrl('derived/9/proxy.mp4');
    expect(lastExpiresIn()).toBe(STREAMED_GET_TTL_SECONDS + PRESIGN_WINDOW_SECONDS);
    expect(defaultGetTtl('derived/9/audio.mp3')).toBe(STREAMED_GET_TTL_SECONDS);
    expect(defaultGetTtl('derived/9/splat.spz')).toBe(DEFAULT_GET_TTL_SECONDS);
  });

  it('always honours an explicitly requested duration', async () => {
    await storage.getPresignedGetUrl('derived/9/thumbnail.jpg', 60);
    expect(lastExpiresIn()).toBe(60 + PRESIGN_WINDOW_SECONDS);
  });

  it('signs only once when the default is explicitly requested again', async () => {
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
