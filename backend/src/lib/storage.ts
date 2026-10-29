// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { OPAQUE_CONTENT_TYPE, safeUploadContentType } from '../lib/uploadContentType';

/**
 * Width of the slice during which a presigned read URL does not change.
 *
 * Without it, every response carried a fresh signature: the browser saw a different URL and re-downloaded
 * the thumbnail or avatar it already had cached. A page of a hundred shots therefore reloaded a hundred JPEGs
 * on every navigation.
 */
export const PRESIGN_WINDOW_SECONDS = 600;

/**
 * Cap on memoized URLs (FIFO eviction). Bounds the memory of a burst of lists: beyond it, the oldest entries
 * lose their cache benefit, never their correctness.
 */
export const PRESIGN_CACHE_MAX = 5000;

/**
 * Maximum number of keys a `DeleteObjects` call accepts (S3 protocol cap, enforced by MinIO). Beyond it, the
 * list is split into slices of this size.
 */
export const DELETE_OBJECTS_BATCH = 1000;

/**
 * Response type derived from the EXTENSION of the storage key.
 *
 * The **stored** `Content-Type` is worthless when the object arrived through a presigned PUT: the presigner
 * only signs `host` (`X-Amz-SignedHeaders=host`), so the uploader sends whatever header it wants. Only the media
 * path corrected this type at finalization (`setObjectContentType`); the other presigned uploads (sheet image,
 * entity thumbnail, department image, HDRI) served the object WITHOUT a forced type, that is, with the uploader's
 * own. The key, for its part, is composed by the server from an already validated type: it is the only safe
 * source, as `lib/uploadContentType` says.
 *
 * Hence the rule, applied here once and for all rather than surface by surface: the key's extension decides the
 * type served, and **anything not recognized is rendered opaque**. No format the browser actively renders (HTML,
 * SVG, XML, JS) is reachable through this table: that is what makes it safe by construction.
 *
 * VFX formats (EXR, GLB, PLY, SPZ, USD, DPX, binary masks, `.cube` LUT) fall to `application/octet-stream`: none is
 * rendered by the browser, all are read by `arrayBuffer()`/`text()` on the viewer side, which does not look at the
 * type. It is already their stored type today, since `safeUploadContentType` brings them back to it on write.
 */
const KEY_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.ts': 'video/mp2t',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

/** Type forced on reading a key, when no explicit type is supplied. */
export function responseTypeFromKey(key: string): string {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  // A dot in a folder name is not an extension; nor is a key without an extension.
  if (dot <= slash + 1) return OPAQUE_CONTENT_TYPE;
  return KEY_CONTENT_TYPES[key.slice(dot).toLowerCase()] ?? OPAQUE_CONTENT_TYPE;
}

/**
 * Default lifetime of a presigned read: content consumed in one block.
 *
 * A presigned URL is bound to no one: the signature covers the bucket, the key and the date, nothing that ties it
 * to the account, the share link or the state of the media. Revoking a share, unpublishing or trashing therefore
 * does NOT cut a link already handed out: only its expiry does. The lifetime is the revocation, and it used to be one hour.
 *
 * Yet the overwhelming majority of these URLs are consumed within seconds of being issued (thumbnails, images, GLB,
 * splats, masks, HDRI, LUT, sprites) and reissued on every page mount (`staleTime` of 30 s on the TanStack Query side).
 * Fifteen minutes comfortably cover the gap between issuing and use, including a download triggered long after the
 * display: S3 only evaluates expiry at the START of the request, and a transfer started in time runs to completion.
 */
export const DEFAULT_GET_TTL_SECONDS = 900;

/**
 * Lifetime of a read **streamed over time** (video, audio).
 *
 * A presigned `<video src>` keeps requesting byte ranges for the whole playback: a short URL would cut the
 * projection in the middle, exactly when nobody can restart it. This content therefore keeps the historical hour.
 * This is the part of A3-05 that this batch does not close, and it must be said: a leaked video link stays readable
 * for up to 70 minutes. Closing it requires serving video behind a route that rechecks access on every request
 * (see `lib/mediaToken`), not shortening further.
 */
export const STREAMED_GET_TTL_SECONDS = 3600;

/** Default lifetime chosen from the nature of the content (see the two constants above). */
export function defaultGetTtl(key: string): number {
  const type = responseTypeFromKey(key);
  return type.startsWith('video/') || type.startsWith('audio/')
    ? STREAMED_GET_TTL_SECONDS
    : DEFAULT_GET_TTL_SECONDS;
}

/**
 * Object storage abstraction (MinIO, S3-compatible).
 *
 * v2 principle: no file touches the filesystem of the application server.
 *  - Upload: presigned PUT URL: the browser writes directly to MinIO (non-blocking).
 *  - Serving: presigned GET URL: the browser reads directly from MinIO.
 * The backend only handles headers (magic-byte validation at finalization).
 */
class StorageService {
  private client: S3Client;
  // Separate client signing with the public endpoint (as seen by the browser), often different from the internal endpoint.
  private publicClient: S3Client;
  private bucket: string;
  /**
   * Presigned read URLs already computed for the current slice.
   * The promise is memoized: two concurrent lists requesting the same thumbnail
   * share one signature instead of computing two.
   */
  private presignCache = new Map<string, { objectKey: string; url: Promise<string> }>();
  private presignSlot = -1;

  constructor() {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
    this.publicClient = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  /** Checks access to the bucket (MinIO health for the admin). */
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /** Idempotent bucket creation at startup, plus CORS configuration. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      logger.info(`[Storage] bucket "${this.bucket}" created.`);
    }
    await this.ensureCors();
  }

  /**
   * Configures the bucket's CORS: required for direct browser access
   *  - presigned PUT uploads (avatars, attachments, PDF documents);
   *  - cross-origin fetch of assets (model-viewer loads GLBs via fetch/XHR).
   * Allowed origins follow CORS_ORIGIN (frontend). Non-blocking on failure.
   */
  private async ensureCors(): Promise<void> {
    const origins =
      env.CORS_ORIGIN === '*'
        ? ['*']
        : env.CORS_ORIGIN.split(',')
            .map((o) => o.trim())
            .filter(Boolean);
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedHeaders: ['*'],
                AllowedMethods: ['GET', 'HEAD', 'PUT'],
                AllowedOrigins: origins,
                ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
      logger.info(`[Storage] CORS configured for ${origins.join(', ')}.`);
    } catch (err) {
      logger.warn(`[Storage] CORS configuration skipped: ${(err as Error).message}`);
    }
  }

  /**
   * Presigned URL for direct browser to MinIO upload.
   *
   * The `Content-Type` comes from the client: it is brought back to a harmless value (see
   * `lib/uploadContentType`) because objects are served from the app's origin.
   * ⚠ This type is **not** binding: the S3 presigner only signs `host` (`X-Amz-SignedHeaders=host`), so the
   * browser remains free to send another header. The definitive type is fixed server-side by
   * `setObjectContentType` (called at finalization), and active rendering is in any case neutralized by the
   * `sandbox` CSP set on the storage path (see `nginx/nginx.conf`).
   */
  async getPresignedPutUrl(key: string, contentType: string, ttlSeconds = 900): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: safeUploadContentType(contentType),
    });
    return getSignedUrl(this.publicClient, cmd, { expiresIn: ttlSeconds });
  }

  // ── Resumable multipart upload (37.A) ─────────────────────────────────────

  /** Starts an S3 multipart upload and returns its UploadId. */
  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: safeUploadContentType(contentType),
      }),
    );
    return res.UploadId!;
  }

  /** Presigned PUT URLs for a batch of parts (browser to MinIO). */
  async getPresignedPartUrls(
    key: string,
    uploadId: string,
    partNumbers: number[],
    ttlSeconds = 3600,
  ): Promise<{ partNumber: number; url: string }[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.publicClient,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: ttlSeconds },
        ),
      })),
    );
  }

  /** Parts already received (source of truth for resuming after a cut). */
  async listUploadedParts(key: string, uploadId: string): Promise<{ partNumber: number; etag: string }[]> {
    const out: { partNumber: number; etag: string }[] = [];
    let marker: string | undefined;
    do {
      const res = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const p of res.Parts ?? []) out.push({ partNumber: p.PartNumber!, etag: p.ETag! });
      marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (marker);
    return out;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .slice()
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
    this.forgetPresignedUrl(key);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  /** Server-to-server copy (dedup 37.B: "instant upload" of content already present). */
  async copyObject(srcKey: string, destKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destKey,
        CopySource: `${this.bucket}/${encodeURIComponent(srcKey).replace(/%2F/g, '/')}`,
      }),
    );
    this.forgetPresignedUrl(destKey);
  }

  /**
   * Rewrites the `Content-Type` of an already stored object, without copying the bytes on the client side
   * (`CopyObject` onto itself + `MetadataDirective: REPLACE`).
   *
   * Essential for upload by presigned PUT: the `ContentType` passed to the signature is **not part of the signed
   * headers** (`X-Amz-SignedHeaders=host`), so the browser may send any type it wants. It is here, server-side,
   * that the type actually stored is fixed. Not needed for multipart upload, whose type is set by
   * `CreateMultipartUpload`: a server call there is authoritative.
   */
  async setObjectContentType(key: string, contentType: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: key,
        CopySource: `${this.bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
        ContentType: safeUploadContentType(contentType),
        MetadataDirective: 'REPLACE',
      }),
    );
    this.forgetPresignedUrl(key);
  }

  /**
   * Presigned URL for direct serving (read) of a media.
   *
   * `contentTypeOverride` forces the `Content-Type` of the RESPONSE, whatever the stored type. Essential wherever the
   * object has no server pass after upload (attachments, avatars, logo, documentation PDFs): the type uploaded there
   * comes from the browser and is therefore not reliable. The parameter travels in the signature: the client can
   * neither remove nor change it without invalidating the URL.
   *
   * **Without an explicit type, the type is derived from the key** (`responseTypeFromKey`): forcing nothing meant
   * serving the object with the type its uploader had chosen, and the four surfaces that have no server pass after
   * upload did just that. Likewise, an omitted `ttlSeconds` takes the duration that suits the nature of the content
   * (`defaultGetTtl`), not one hour for everyone.
   *
   * The URL is **stable for a slice of `PRESIGN_WINDOW_SECONDS`**: with the same key, forced type and duration, two
   * calls return the same string, so the browser reuses its cache instead of re-downloading. Stability also holds
   * across processes (API and worker) because the signing date is pinned to the start of the slice and not taken at
   * the moment of the call.
   */
  async getPresignedGetUrl(key: string, ttlSeconds?: number, contentTypeOverride?: string): Promise<string> {
    const ttl = ttlSeconds ?? defaultGetTtl(key);
    const imposed = contentTypeOverride ?? responseTypeFromKey(key);
    const slot = Math.floor(Date.now() / 1000 / PRESIGN_WINDOW_SECONDS);
    // Slice change: none of these URLs will be reproduced again, so we start empty.
    if (slot !== this.presignSlot) {
      this.presignCache.clear();
      this.presignSlot = slot;
    }
    // Unambiguous key: a forced type or a file name may contain any character, so the three fields are
    // serialized rather than concatenated. The RESOLVED values: asking for the default or asking for it
    // explicitly is the same URL, which must not be signed twice.
    const cacheKey = JSON.stringify([ttl, imposed, key]);
    const hit = this.presignCache.get(cacheKey);
    if (hit) return hit.url;

    const url = this.signGetUrl(key, ttl, slot, imposed);
    this.presignCache.set(cacheKey, { objectKey: key, url });
    // A failed signature must not stay memoized, and waiting for the rejection here avoids an
    // "unhandled rejection" if the caller has already handled the error.
    void url.catch(() => {
      if (this.presignCache.get(cacheKey)?.url === url) this.presignCache.delete(cacheKey);
    });
    while (this.presignCache.size > PRESIGN_CACHE_MAX) {
      const oldest = this.presignCache.keys().next();
      if (oldest.done) break;
      this.presignCache.delete(oldest.value);
    }
    return url;
  }

  /**
   * Signs a read, dated at the start of slice `slot`.
   *
   * The requested validity is extended by the slice width: a URL returned at the very end of a slice stays valid at
   * least as long as the caller asked for, so memoization never shortens the lifetime of a link.
   */
  private signGetUrl(key: string, ttlSeconds: number, slot: number, contentType: string): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Second filter: even a type explicitly passed by a caller may come from the client (attachment,
      // board file), so it goes through the allowlist again.
      ResponseContentType: safeUploadContentType(contentType),
    });
    return getSignedUrl(this.publicClient, cmd, {
      expiresIn: ttlSeconds + PRESIGN_WINDOW_SECONDS,
      signingDate: new Date(slot * PRESIGN_WINDOW_SECONDS * 1000),
    });
  }

  /**
   * Forgets the memoized URL of an object.
   *
   * To be called after any rewrite of an object **under the same key** done outside this service: typically a browser
   * upload via presigned URL (avatar, entity thumbnail). Without it, the returned URL would stay identical until the
   * end of the slice, so the browser would keep displaying the old image from its cache.
   * Writes that go through this service (`putObject`, `copyObject`, `setObjectContentType`, deletions) forget
   * automatically.
   */
  forgetPresignedUrl(key: string): void {
    for (const [cacheKey, entry] of this.presignCache) {
      if (entry.objectKey === key) this.presignCache.delete(cacheKey);
    }
  }

  /** Prefix variant, for bulk deletions (a whole media, a whole version). */
  private forgetPresignedPrefix(prefix: string): void {
    for (const [cacheKey, entry] of this.presignCache) {
      if (entry.objectKey.startsWith(prefix)) this.presignCache.delete(cacheKey);
    }
  }

  /**
   * Server write to MinIO (avatars, derivatives generated by the workers).
   *
   * The type goes through the same allowlist as the other write paths: "server" does not mean "trusted". An attachment
   * or a media fetched from a ShotGrid site arrives here with the `Content-Type` announced by that site: `text/html` or
   * `image/svg+xml` are therefore possible, and the object is served from the application's origin. The types actually
   * produced by the workers (mp4, jpeg, HLS playlists) are in the list; binary formats (GLB, splat masks) fall, as they
   * should, to `application/octet-stream`.
   */
  async putObject(key: string, body: Buffer | Readable, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: safeUploadContentType(contentType),
      }),
    );
    // The worker rewrites a thumbnail under the same key: without this forgetting, the card would keep
    // displaying the old image until the end of the slice.
    this.forgetPresignedUrl(key);
  }

  /** Streamed read of an object. */
  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  /**
   * Whole object in memory. Reserved for contents whose size is under control (thumbnails, sends to a third-party API
   * that requires a single body): for anything that may be heavy, prefer `getObjectStream` or `downloadToFile`.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = await this.getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** Reads the first `length` bytes of an object (magic-byte validation). */
  async getObjectHeader(key: string, length = 32): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${length - 1}` }),
    );
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** Downloads a MinIO object to a local file (used by the workers). */
  async downloadToFile(key: string, destPath: string): Promise<void> {
    const stream = await this.getObjectStream(key);
    await pipeline(stream, createWriteStream(destPath));
  }

  /** Sends a local file to MinIO (derivatives generated by the workers). */
  async uploadFile(key: string, srcPath: string, contentType: string): Promise<void> {
    await this.putObject(key, createReadStream(srcPath), contentType);
  }

  /** Object metadata (size, contentType). */
  async statObject(key: string): Promise<{ size: number; contentType?: string }> {
    const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { size: res.ContentLength ?? 0, contentType: res.ContentType };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.forgetPresignedUrl(key);
  }

  /**
   * Bulk deletion (`DeleteObjects`), up to `DELETE_OBJECTS_BATCH` keys per call.
   *
   * Emptying the trash of two hundred media used to delete the objects one by one, in series, within the HTTP request:
   * four hundred MinIO round trips where the protocol offers one. S3 caps the call at 1,000 keys, hence the splitting.
   *
   * Returns the keys the storage REFUSED (the `Errors` element of the response) rather than throwing: a partial deletion
   * is a normal event here, and the caller needs the exact list to queue a retry. A transport failure, on the other hand,
   * is propagated: it is the same rule as `deleteObject`.
   */
  async deleteObjects(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const refused: string[] = [];
    for (let i = 0; i < keys.length; i += DELETE_OBJECTS_BATCH) {
      const batch = keys.slice(i, i + DELETE_OBJECTS_BATCH);
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
      for (const err of res.Errors ?? []) if (err.Key) refused.push(err.Key);
    }
    // A single sweep of the cache for the whole batch: `forgetPresignedUrl` per key would cost here a
    // thousand traversals of a five-thousand-entry table.
    this.forgetPresignedKeys(new Set(keys));
    return refused;
  }

  /** Grouped forgetting: a single traversal of the cache for a batch of deleted keys. */
  private forgetPresignedKeys(keys: Set<string>): void {
    if (keys.size === 0) return;
    for (const [cacheKey, entry] of this.presignCache) {
      if (keys.has(entry.objectKey)) this.presignCache.delete(cacheKey);
    }
  }

  /** Iterates all objects of the bucket (key + size): storage mapping (admin). */
  async *iterateObjects(prefix?: string): AsyncGenerator<{ key: string; size: number }> {
    let continuationToken: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const o of list.Contents ?? []) yield { key: o.Key!, size: o.Size ?? 0 };
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  /** Deletes all objects under a prefix (e.g. a whole MediaObject or a Version). */
  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const objects = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objects.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }),
        );
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);
    this.forgetPresignedPrefix(prefix);
  }

  // ── Key conventions ────────────────────────────────────────────────────
  /**
   * Readable media key (hierarchical slugs):
   *   projects/{projectSlug}/{parentSegment}/{versionName}/{mediaId}/{filenameSain}
   * The `mediaId` stays as a folder to guarantee uniqueness even with identical names.
   */
  static mediaKey(args: {
    projectSlug: string;
    parentSegment: string;
    versionName: string;
    mediaId: number;
    filename: string;
  }): string {
    const { projectSlug, parentSegment, versionName, mediaId, filename } = args;
    return `projects/${projectSlug}/${parentSegment}/${versionName}/${mediaId}/${filename}`;
  }
  static thumbnailKey(mediaId: number, ext = 'webp'): string {
    return `derived/${mediaId}/thumbnail.${ext}`;
  }
  /** Non-destructive deletion mask of a splat (binary bitset): 10.G. */
  static splatMaskKey(mediaId: number): string {
    return `derived/${mediaId}/splat-mask.bin`;
  }
  /** Subset transforms of splats (delta + index binary ops): Phase 28. */
  static splatSubsetKey(mediaId: number): string {
    return `derived/${mediaId}/splat-subset.bin`;
  }
  static avatarKey(userId: number, ext: string): string {
    return `avatars/${userId}${ext}`;
  }
  /**
   * Thumbnail chosen by hand for a sequence, a shot or an asset (C3). The `thumbnailKey` column and the PATCH had existed
   * for a long time, but nothing could produce the key: no entity had ever been able to carry an image.
   */
  static entityThumbnailKey(holder: 'sequence' | 'shot' | 'asset', id: number, ext: string): string {
    return `entity-thumbs/${holder}/${id}${ext}`;
  }

  /**
   * Image of a department. Same key shape, same reserved prefix: it depends only on the identifier and the extension,
   * so replacing the image rewrites the same object, and the client cannot point a department elsewhere.
   */
  static departmentImageKey(id: number, ext: string): string {
    return `entity-thumbs/department/${id}${ext}`;
  }
}

export const storage = new StorageService();
export { StorageService };
