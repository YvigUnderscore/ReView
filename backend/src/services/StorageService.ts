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
import { safeUploadContentType } from '../lib/uploadContentType';

/**
 * Abstraction du stockage objet (MinIO, S3-compatible).
 *
 * Principe v2 : aucun fichier ne touche le filesystem du serveur applicatif.
 *  - Upload : URL présignée PUT → le navigateur écrit directement dans MinIO (non-bloquant).
 *  - Serving : URL présignée GET → le navigateur lit directement depuis MinIO.
 * Le backend ne manipule que des en-têtes (validation magic bytes à la finalisation).
 */
class StorageService {
  private client: S3Client;
  // Client séparé signant avec l'endpoint public (vu par le navigateur), souvent ≠ endpoint interne.
  private publicClient: S3Client;
  private bucket: string;

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

  /** Vérifie l'accès au bucket (santé MinIO pour l'admin). */
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /** Création idempotente du bucket au démarrage + configuration CORS. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      logger.info(`[Storage] bucket « ${this.bucket} » créé.`);
    }
    await this.ensureCors();
  }

  /**
   * Configure le CORS du bucket : indispensable pour les accès navigateur directs
   *  - uploads présignés PUT (avatars, pièces jointes, documents PDF) ;
   *  - fetch cross-origin des assets (model-viewer charge les GLB via fetch/XHR).
   * Les origines autorisées suivent CORS_ORIGIN (frontend). Échec non bloquant.
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
      logger.info(`[Storage] CORS configuré pour ${origins.join(', ')}.`);
    } catch (err) {
      logger.warn(`[Storage] Configuration CORS ignorée : ${(err as Error).message}`);
    }
  }

  /**
   * URL présignée pour l'upload direct navigateur → MinIO.
   * Le `Content-Type` vient du client : il est ramené à une valeur inoffensive
   * (cf. `lib/uploadContentType`) car les objets sont servis depuis l'origine de l'app.
   * La signature porte le type neutralisé — le navigateur ne peut donc pas en imposer
   * un autre au PUT sans invalider la signature.
   */
  async getPresignedPutUrl(key: string, contentType: string, ttlSeconds = 900): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: safeUploadContentType(contentType),
    });
    return getSignedUrl(this.publicClient, cmd, { expiresIn: ttlSeconds });
  }

  // ── Upload résumable multipart (37.A) ─────────────────────────────────────

  /** Démarre un upload multipart S3 et renvoie son UploadId. */
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

  /** URLs présignées PUT pour un lot de parts (navigateur → MinIO). */
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

  /** Parts déjà reçues (source de vérité de la reprise après coupure). */
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
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  /** Copie serveur → serveur (dédup 37.B : « upload instantané » d'un contenu déjà présent). */
  async copyObject(srcKey: string, destKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destKey,
        CopySource: `${this.bucket}/${encodeURIComponent(srcKey).replace(/%2F/g, '/')}`,
      }),
    );
  }

  /** URL présignée pour le serving direct (lecture) d'un média. */
  async getPresignedGetUrl(key: string, ttlSeconds = 3600): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.publicClient, cmd, { expiresIn: ttlSeconds });
  }

  /** Écriture serveur → MinIO (avatars, dérivés générés par les workers). */
  async putObject(key: string, body: Buffer | Readable, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Lecture d'un objet en flux. */
  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  /** Lit les `length` premiers octets d'un objet (validation magic bytes). */
  async getObjectHeader(key: string, length = 32): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${length - 1}` }),
    );
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** Télécharge un objet MinIO vers un fichier local (utilisé par les workers). */
  async downloadToFile(key: string, destPath: string): Promise<void> {
    const stream = await this.getObjectStream(key);
    await pipeline(stream, createWriteStream(destPath));
  }

  /** Envoie un fichier local vers MinIO (dérivés générés par les workers). */
  async uploadFile(key: string, srcPath: string, contentType: string): Promise<void> {
    await this.putObject(key, createReadStream(srcPath), contentType);
  }

  /** Métadonnées d'un objet (taille, contentType). */
  async statObject(key: string): Promise<{ size: number; contentType?: string }> {
    const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { size: res.ContentLength ?? 0, contentType: res.ContentType };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Itère tous les objets du bucket (clé + taille) — cartographie stockage (admin). */
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

  /** Supprime tous les objets sous un préfixe (ex. tout un MediaObject ou une Version). */
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
  }

  // ── Conventions de clés ────────────────────────────────────────────────────
  /**
   * Clé média lisible (slugs hiérarchiques) :
   *   projects/{projectSlug}/{parentSegment}/{versionName}/{mediaId}/{filenameSain}
   * Le `mediaId` reste comme dossier pour garantir l'unicité même en cas de noms identiques.
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
  /** Masque de suppression non-destructif d'un splat (bitset binaire) — 10.G. */
  static splatMaskKey(mediaId: number): string {
    return `derived/${mediaId}/splat-mask.bin`;
  }
  /** Transformations de sous-ensembles de splats (ops binaires delta+indices) — Phase 28. */
  static splatSubsetKey(mediaId: number): string {
    return `derived/${mediaId}/splat-subset.bin`;
  }
  static avatarKey(userId: number, ext: string): string {
    return `avatars/${userId}${ext}`;
  }
}

export const storage = new StorageService();
export { StorageService };
