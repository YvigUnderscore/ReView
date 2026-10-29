// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Memoization of presigned read URLs.
 *
 * The invariant held here is the one of the browser cache: with the same key, forced type and duration,
 * two calls return the SAME string for the whole slice. Otherwise the browser sees a new URL and re-downloads
 * a thumbnail it already has. The corollary, just as important, is that rewriting the object breaks this
 * stability: a URL frozen on stale content would be a functional regression, not an optimization.
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

/** Options passed to the presigner on the last call that actually signed. */
const lastSigningOptions = () => signed.mock.calls.at(-1)![2] as { expiresIn: number; signingDate: Date };

const THUMB = 'derived/42/thumbnail.jpg';

let counter = 0;

beforeEach(() => {
  vi.useFakeTimers();
    // An arbitrary instant, deliberately offset from the start of a slice.
  vi.setSystemTime(new Date('2026-08-21T10:03:20.000Z'));
  vi.clearAllMocks();
  counter = 0;
  send.mockResolvedValue({});
    // Each signature returns a distinct string: two calls returning the same value therefore prove
    // the memoization, not a mock coincidence.
  signed.mockImplementation(() => Promise.resolve(`https://minio/signed/${++counter}`));
    // The current slice starts afresh for each test.
  storage.forgetPresignedUrl(THUMB);
});

afterEach(() => vi.useRealTimers());

describe('getPresignedGetUrl: URL stability', () => {
  it('returns the same URL for the same thumbnail within the same slice', async () => {
    const first = await storage.getPresignedGetUrl(THUMB);
    const second = await storage.getPresignedGetUrl(THUMB);
    expect(second).toBe(first);
    expect(signed).toHaveBeenCalledTimes(1);
  });

  it('shares one signing between two concurrent requests for the same thumbnail', async () => {
    const [a, b] = await Promise.all([
      storage.getPresignedGetUrl('derived/7/thumbnail.jpg'),
      storage.getPresignedGetUrl('derived/7/thumbnail.jpg'),
    ]);
    expect(a).toBe(b);
    expect(signed).toHaveBeenCalledTimes(1);
  });

  it('pins the signing date to the start of the slice', async () => {
        // Two processes (API and worker) signing during the same slice thus produce the same URL: the
        // browser cache survives a change of backend.
    await storage.getPresignedGetUrl('derived/8/thumbnail.jpg');
    const { signingDate } = lastSigningOptions();
    expect(signingDate.getTime() % (PRESIGN_WINDOW_SECONDS * 1000)).toBe(0);
    expect(Date.now() - signingDate.getTime()).toBeLessThan(PRESIGN_WINDOW_SECONDS * 1000);
  });

  it('extends the validity by the slice width, so a link is never shortened', async () => {
        // A URL returned at the very end of a slice must stay valid for as long as the caller asked.
    await storage.getPresignedGetUrl('derived/9/thumbnail.jpg', 3600);
    const { expiresIn, signingDate } = lastSigningOptions();
    expect(expiresIn).toBe(3600 + PRESIGN_WINDOW_SECONDS);
    const endOfSlot = signingDate.getTime() + PRESIGN_WINDOW_SECONDS * 1000;
    expect(signingDate.getTime() + expiresIn * 1000 - endOfSlot).toBeGreaterThanOrEqual(3600 * 1000);
  });

  it('re-signs in the next slice', async () => {
    const before = await storage.getPresignedGetUrl(THUMB);
    vi.advanceTimersByTime(PRESIGN_WINDOW_SECONDS * 1000);
    const after = await storage.getPresignedGetUrl(THUMB);
    expect(after).not.toBe(before);
    expect(signed).toHaveBeenCalledTimes(2);
  });

  it('does not confuse two requests that do not carry the same contract', async () => {
    const plain = await storage.getPresignedGetUrl('avatars/3.png');
    const typed = await storage.getPresignedGetUrl('avatars/3.png', 3600, 'image/png');
    const shortLived = await storage.getPresignedGetUrl('avatars/3.png', 60);
    const other = await storage.getPresignedGetUrl('avatars/4.png');
    expect(new Set([plain, typed, shortLived, other]).size).toBe(4);
  });

  it('keeps the normalization of the forced type', async () => {
    await storage.getPresignedGetUrl('a/b.svg', 3600, 'image/svg+xml');
    const cmd = signed.mock.calls.at(-1)![1] as { input: { ResponseContentType?: string } };
    expect(cmd.input.ResponseContentType).toBe('application/octet-stream');
  });

  it('does not memoize a failed signature', async () => {
    signed.mockRejectedValueOnce(new Error('minio down'));
    await expect(storage.getPresignedGetUrl('derived/11/thumbnail.jpg')).rejects.toThrow('minio down');
    signed.mockImplementation(() => Promise.resolve('https://minio/ok'));
    await expect(storage.getPresignedGetUrl('derived/11/thumbnail.jpg')).resolves.toBe('https://minio/ok');
  });

  it('bounds the number of memoized URLs', async () => {
    for (let i = 0; i < PRESIGN_CACHE_MAX + 1; i++) {
      await storage.getPresignedGetUrl(`derived/cap-${i}/thumbnail.jpg`);
    }
    const calls = signed.mock.calls.length;
        // The oldest was evicted (it is re-signed), the most recent is still there.
    await storage.getPresignedGetUrl('derived/cap-0/thumbnail.jpg');
    expect(signed.mock.calls.length).toBe(calls + 1);
    await storage.getPresignedGetUrl(`derived/cap-${PRESIGN_CACHE_MAX}/thumbnail.jpg`);
    expect(signed.mock.calls.length).toBe(calls + 1);
  });
});

describe('getPresignedGetUrl: freshness after rewrite', () => {
  it('forgets the URL when the object is rewritten under the same key', async () => {
    const before = await storage.getPresignedGetUrl(THUMB);
    await storage.putObject(THUMB, Buffer.from('x'), 'image/jpeg');
    expect(await storage.getPresignedGetUrl(THUMB)).not.toBe(before);
  });

  it('also forgets after uploadFile, copyObject and setObjectContentType', async () => {
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

  it('forgets all variants of a key, whatever the forced type', async () => {
    const plain = await storage.getPresignedGetUrl('avatars/5.png');
    const typed = await storage.getPresignedGetUrl('avatars/5.png', 3600, 'image/png');
    storage.forgetPresignedUrl('avatars/5.png');
    expect(await storage.getPresignedGetUrl('avatars/5.png')).not.toBe(plain);
    expect(await storage.getPresignedGetUrl('avatars/5.png', 3600, 'image/png')).not.toBe(typed);
  });

  it('forgets a whole prefix when a media is deleted', async () => {
    const thumb = await storage.getPresignedGetUrl('derived/77/thumbnail.jpg');
    const mask = await storage.getPresignedGetUrl('derived/77/splat-mask.bin');
    const other = await storage.getPresignedGetUrl('derived/78/thumbnail.jpg');
    send.mockResolvedValue({ Contents: [{ Key: 'derived/77/thumbnail.jpg' }], IsTruncated: false });
    await storage.deletePrefix('derived/77/');
    expect(await storage.getPresignedGetUrl('derived/77/thumbnail.jpg')).not.toBe(thumb);
    expect(await storage.getPresignedGetUrl('derived/77/splat-mask.bin')).not.toBe(mask);
        // The neighbour, for its part, did not move.
    expect(await storage.getPresignedGetUrl('derived/78/thumbnail.jpg')).toBe(other);
  });

  it('forgets the URL after a completed multipart upload', async () => {
    const before = await storage.getPresignedGetUrl('projects/p/v/4/big.mov');
    await storage.completeMultipartUpload('projects/p/v/4/big.mov', 'upload-1', [
      { partNumber: 1, etag: 'e1' },
    ]);
    expect(await storage.getPresignedGetUrl('projects/p/v/4/big.mov')).not.toBe(before);
  });

  it('forgets the URL when a single object is deleted', async () => {
    const before = await storage.getPresignedGetUrl('avatars/9.png');
    await storage.deleteObject('avatars/9.png');
    expect(await storage.getPresignedGetUrl('avatars/9.png')).not.toBe(before);
  });
});
