// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Storage client operations against a fake S3 client: each command is recorded with its name and input, so
 * the suite checks what is actually sent to MinIO (pagination, part ordering, CORS rules) without a server.
 */
const { send, signed, envMock, writes, logger } = vi.hoisted(() => ({
  send: vi.fn(),
  signed: vi.fn(),
  envMock: {
    S3_BUCKET: 'review',
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    CORS_ORIGIN: '*',
  },
  writes: [] as string[],
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@aws-sdk/client-s3', () => {
  const command = (name: string) =>
    class {
      name = name;
      constructor(public input: Record<string, unknown>) {}
    };
  return {
    S3Client: class {
      send = send;
    },
    CreateBucketCommand: command('CreateBucket'),
    HeadBucketCommand: command('HeadBucket'),
    PutObjectCommand: command('PutObject'),
    GetObjectCommand: command('GetObject'),
    HeadObjectCommand: command('HeadObject'),
    DeleteObjectCommand: command('DeleteObject'),
    DeleteObjectsCommand: command('DeleteObjects'),
    ListObjectsV2Command: command('ListObjectsV2'),
    PutBucketCorsCommand: command('PutBucketCors'),
    CreateMultipartUploadCommand: command('CreateMultipartUpload'),
    UploadPartCommand: command('UploadPart'),
    CompleteMultipartUploadCommand: command('CompleteMultipartUpload'),
    AbortMultipartUploadCommand: command('AbortMultipartUpload'),
    ListPartsCommand: command('ListParts'),
    CopyObjectCommand: command('CopyObject'),
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: signed }));
vi.mock('node:fs', async () => {
  const { Writable } = await import('node:stream');
  return {
    createReadStream: vi.fn((path: string) => `stream:${path}`),
    createWriteStream: vi.fn(
      () =>
        new Writable({
          write(chunk: Buffer, _enc, cb) {
            writes.push(chunk.toString());
            cb();
          },
        }),
    ),
  };
});
vi.mock('./logger', () => ({ logger }));
vi.mock('../config/env', () => ({ env: envMock }));

import { StorageService, storage } from './storage';

type Sent = { name: string; input: Record<string, unknown> };
const sent = (): Sent[] => send.mock.calls.map((c) => c[0] as Sent);
const named = (name: string) => sent().filter((c) => c.name === name);

beforeEach(() => {
  send.mockReset();
  signed.mockReset();
  vi.clearAllMocks();
  writes.length = 0;
  envMock.CORS_ORIGIN = '*';
});

describe('bucket bootstrap', () => {
  it('ping is true when the bucket answers, false otherwise', async () => {
    send.mockResolvedValueOnce({});
    expect(await storage.ping()).toBe(true);
    send.mockRejectedValueOnce(new Error('down'));
    expect(await storage.ping()).toBe(false);
  });

  it('creates a missing bucket, then configures CORS from CORS_ORIGIN', async () => {
    envMock.CORS_ORIGIN = 'https://a.example, https://b.example,';
    send.mockRejectedValueOnce(new Error('NotFound')).mockResolvedValue({});
    await storage.ensureBucket();
    expect(named('CreateBucket')).toHaveLength(1);
    const rules = (
      named('PutBucketCors')[0]!.input.CORSConfiguration as { CORSRules: { AllowedOrigins: string[] }[] }
    ).CORSRules;
    expect(rules[0]!.AllowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('keeps an existing bucket and survives a CORS refusal', async () => {
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('NotImplemented'));
    await expect(storage.ensureBucket()).resolves.toBeUndefined();
    expect(named('CreateBucket')).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('NotImplemented'));
  });
});

describe('multipart upload', () => {
  it('starts an upload with a sanitized content type', async () => {
    send.mockResolvedValueOnce({ UploadId: 'u-1' });
    expect(await storage.createMultipartUpload('k', 'text/html')).toBe('u-1');
    expect(named('CreateMultipartUpload')[0]!.input.ContentType).not.toBe('text/html');
  });

  it('presigns one URL per part', async () => {
    signed.mockImplementation(async (_client, cmd: Sent) => `https://put/${cmd.input.PartNumber as number}`);
    expect(await storage.getPresignedPartUrls('k', 'u', [1, 2])).toEqual([
      { partNumber: 1, url: 'https://put/1' },
      { partNumber: 2, url: 'https://put/2' },
    ]);
  });

  it('lists the received parts across pages', async () => {
    send
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 1, ETag: 'a' }],
        IsTruncated: true,
        NextPartNumberMarker: '1',
      })
      .mockResolvedValueOnce({ Parts: [{ PartNumber: 2, ETag: 'b' }], IsTruncated: false });
    expect(await storage.listUploadedParts('k', 'u')).toEqual([
      { partNumber: 1, etag: 'a' },
      { partNumber: 2, etag: 'b' },
    ]);
    expect(named('ListParts')[1]!.input.PartNumberMarker).toBe('1');
  });

  it('completes with the parts sorted, and aborts', async () => {
    send.mockResolvedValue({});
    await storage.completeMultipartUpload('k', 'u', [
      { partNumber: 2, etag: 'b' },
      { partNumber: 1, etag: 'a' },
    ]);
    expect(named('CompleteMultipartUpload')[0]!.input.MultipartUpload).toEqual({
      Parts: [
        { PartNumber: 1, ETag: 'a' },
        { PartNumber: 2, ETag: 'b' },
      ],
    });
    await storage.abortMultipartUpload('k', 'u');
    expect(named('AbortMultipartUpload')[0]!.input).toEqual({ Bucket: 'review', Key: 'k', UploadId: 'u' });
  });
});

describe('object reads and writes', () => {
  it('presigns a PUT with a sanitized type', async () => {
    signed.mockResolvedValueOnce('https://put');
    expect(await storage.getPresignedPutUrl('k', 'image/png', 60)).toBe('https://put');
    expect(signed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'PutObject' }), {
      expiresIn: 60,
    });
  });

  it('rewrites a stored content type in place', async () => {
    send.mockResolvedValue({});
    await storage.setObjectContentType('a b/c.png', 'image/png');
    expect(named('CopyObject')[0]!.input).toMatchObject({
      Key: 'a b/c.png',
      CopySource: 'review/a%20b/c.png',
      MetadataDirective: 'REPLACE',
      ContentType: 'image/png',
    });
  });

  it('reads a whole object and its header', async () => {
    send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('ab'), Buffer.from('cd')]) });
    expect((await storage.getObjectBuffer('k')).toString()).toBe('abcd');
    send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('magic')]) });
    expect((await storage.getObjectHeader('k', 8)).toString()).toBe('magic');
    expect(named('GetObject')[1]!.input.Range).toBe('bytes=0-7');
  });

  it('downloads to a file and uploads a local file', async () => {
    send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('payload')]) });
    await storage.downloadToFile('k', '/tmp/x');
    expect(writes.join('')).toBe('payload');
    send.mockResolvedValueOnce({});
    await storage.uploadFile('derived/1/proxy.mp4', '/tmp/proxy.mp4', 'video/mp4');
    expect(named('PutObject')[0]!.input).toMatchObject({
      Body: 'stream:/tmp/proxy.mp4',
      ContentType: 'video/mp4',
    });
  });

  it('stats an object, defaulting a missing size to 0', async () => {
    send.mockResolvedValueOnce({ ContentLength: 12, ContentType: 'image/png' }).mockResolvedValueOnce({});
    expect(await storage.statObject('k')).toEqual({ size: 12, contentType: 'image/png' });
    expect(await storage.statObject('k')).toEqual({ size: 0, contentType: undefined });
  });
});

describe('listing and prefix deletion', () => {
  it('iterates every object across pages', async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a', Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: 't',
      })
      .mockResolvedValueOnce({ Contents: [{ Key: 'b' }], IsTruncated: false });
    const seen: { key: string; size: number }[] = [];
    for await (const o of storage.iterateObjects('p/')) seen.push(o);
    expect(seen).toEqual([
      { key: 'a', size: 1 },
      { key: 'b', size: 0 },
    ]);
  });

  it('deletes a prefix page by page, skipping empty pages', async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'p/1' }], IsTruncated: true, NextContinuationToken: 't' })
      .mockResolvedValueOnce({}) // DeleteObjects
      .mockResolvedValueOnce({ Contents: [], IsTruncated: false });
    await storage.deletePrefix('p/');
    expect(named('DeleteObjects')).toHaveLength(1);
    expect(named('DeleteObjects')[0]!.input.Delete).toEqual({ Objects: [{ Key: 'p/1' }] });
    expect(named('ListObjectsV2')[1]!.input.ContinuationToken).toBe('t');
  });
});

describe('key conventions', () => {
  it('builds the documented keys', () => {
    expect(
      StorageService.mediaKey({
        projectSlug: 'p',
        parentSegment: 'sq/sh',
        versionName: 'v001',
        mediaId: 4,
        filename: 'f.mov',
      }),
    ).toBe('projects/p/sq/sh/v001/4/f.mov');
    expect(StorageService.thumbnailKey(4)).toBe('derived/4/thumbnail.webp');
    expect(StorageService.splatMaskKey(4)).toBe('derived/4/splat-mask.bin');
    expect(StorageService.splatSubsetKey(4)).toBe('derived/4/splat-subset.bin');
    expect(StorageService.avatarKey(3, '.png')).toBe('avatars/3.png');
    expect(StorageService.entityThumbnailKey('shot', 9, '.jpg')).toBe('entity-thumbs/shot/9.jpg');
    expect(StorageService.departmentImageKey(2, '.webp')).toBe('entity-thumbs/department/2.webp');
  });
});
