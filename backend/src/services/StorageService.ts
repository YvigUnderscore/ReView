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
 * Largeur de la tranche pendant laquelle une URL présignée de lecture ne bouge pas.
 *
 * Sans elle, chaque réponse portait une signature neuve : le navigateur voyait une URL
 * différente et retéléchargeait la vignette ou l'avatar qu'il avait déjà en cache. Une
 * page de cent plans rechargeait donc cent JPEG à chaque navigation.
 */
export const PRESIGN_WINDOW_SECONDS = 600;

/**
 * Plafond d'URL mémorisées (éviction FIFO). Borne la mémoire d'un pic de listes : au-delà,
 * on perd le bénéfice de cache sur les plus anciennes, jamais la justesse.
 */
export const PRESIGN_CACHE_MAX = 5000;

/**
 * Nombre maximal de clés qu'un appel `DeleteObjects` accepte (plafond du protocole S3,
 * respecté par MinIO). Au-delà, la liste est découpée en tranches de cette taille.
 */
export const DELETE_OBJECTS_BATCH = 1000;

/**
 * Type de réponse déduit de l'EXTENSION de la clé de stockage.
 *
 * Le `Content-Type` **stocké** ne vaut rien quand l'objet est arrivé par PUT présigné : le
 * presigner ne signe que `host` (`X-Amz-SignedHeaders=host`), le déposant envoie donc
 * l'en-tête qu'il veut. Seul le chemin média corrigeait ce type à la finalisation
 * (`setObjectContentType`) ; les autres dépôts présignés — image de fiche, vignette
 * d'entité, image de département, HDRI — rendaient l'objet SANS type imposé, c'est-à-dire
 * avec celui du déposant. La clé, elle, est composée par le serveur à partir d'un type déjà
 * validé : c'est la seule source sûre, comme le dit `lib/uploadContentType`.
 *
 * D'où la règle, appliquée ici une fois pour toutes plutôt que surface par surface :
 * l'extension de la clé décide du type servi, et **tout ce qui n'est pas reconnu est rendu
 * opaque**. Aucun format que le navigateur rend activement (HTML, SVG, XML, JS) n'est
 * atteignable par cette table — c'est ce qui la rend sûre par construction.
 *
 * Les formats VFX (EXR, GLB, PLY, SPZ, USD, DPX, masques binaires, LUT `.cube`) tombent sur
 * `application/octet-stream` : aucun n'est rendu par le navigateur, tous sont lus par
 * `arrayBuffer()`/`text()` côté viewer, qui ne regarde pas le type. C'est déjà leur type
 * stocké aujourd'hui, `safeUploadContentType` les y ramenant à l'écriture.
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

/** Type imposé à la lecture d'une clé, à défaut d'un type explicitement fourni. */
export function responseTypeFromKey(key: string): string {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  // Un point dans un nom de dossier n'est pas une extension ; une clé sans extension non plus.
  if (dot <= slash + 1) return OPAQUE_CONTENT_TYPE;
  return KEY_CONTENT_TYPES[key.slice(dot).toLowerCase()] ?? OPAQUE_CONTENT_TYPE;
}

/**
 * Durée de vie par défaut d'une lecture présignée — contenu consommé d'un bloc.
 *
 * Une URL présignée n'est liée à personne : la signature couvre le bucket, la clé et la
 * date, rien qui la rattache au compte, au lien de partage ou à l'état du média. Révoquer un
 * partage, dépublier ou mettre à la corbeille ne coupe donc PAS un lien déjà remis — seule
 * son expiration le fait. La durée est la révocation, et elle était d'une heure.
 *
 * Or l'écrasante majorité de ces URL est consommée dans la seconde qui suit son émission
 * (vignettes, images, GLB, splats, masques, HDRI, LUT, sprites) et réémise à chaque montage
 * de page (`staleTime` de 30 s côté TanStack Query). Quinze minutes couvrent très largement
 * l'écart entre l'émission et l'usage, y compris un téléchargement déclenché longtemps après
 * l'affichage — S3 n'évalue l'expiration qu'au DÉBUT de la requête, un transfert commencé à
 * temps va à son terme.
 */
export const DEFAULT_GET_TTL_SECONDS = 900;

/**
 * Durée de vie d'une lecture **diffusée dans la durée** (vidéo, audio).
 *
 * Un `<video src>` présigné redemande des tranches d'octets pendant toute la lecture : une
 * URL courte couperait la projection en son milieu, exactement au moment où personne ne peut
 * la relancer. Ce contenu garde donc l'heure historique — c'est la part de A3-05 que ce lot
 * ne ferme pas, et il faut le dire : un lien de vidéo qui fuit reste lisible jusqu'à 70 min.
 * La fermer suppose de servir la vidéo derrière une route qui revérifie l'accès à chaque
 * requête (cf. `lib/mediaToken`), pas de raccourcir davantage.
 */
export const STREAMED_GET_TTL_SECONDS = 3600;

/** Durée par défaut choisie sur la nature du contenu (cf. les deux constantes ci-dessus). */
export function defaultGetTtl(key: string): number {
  const type = responseTypeFromKey(key);
  return type.startsWith('video/') || type.startsWith('audio/')
    ? STREAMED_GET_TTL_SECONDS
    : DEFAULT_GET_TTL_SECONDS;
}

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
  /**
   * URL présignées de lecture déjà calculées pour la tranche en cours.
   * On mémorise la promesse : deux listes concurrentes qui demandent la même vignette
   * partagent la même signature au lieu d'en calculer deux.
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
   *
   * Le `Content-Type` vient du client : il est ramené à une valeur inoffensive
   * (cf. `lib/uploadContentType`) car les objets sont servis depuis l'origine de l'app.
   * ⚠ Ce type n'est **pas** contraignant : le presigner S3 ne signe que `host`
   * (`X-Amz-SignedHeaders=host`), le navigateur reste libre d'envoyer un autre en-tête.
   * Le type définitif est arrêté côté serveur par `setObjectContentType` (appelé à la
   * finalisation), et le rendu actif est de toute façon neutralisé par la CSP `sandbox`
   * posée sur le chemin de stockage (cf. `nginx/nginx.conf`).
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
    this.forgetPresignedUrl(key);
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
    this.forgetPresignedUrl(destKey);
  }

  /**
   * Réécrit le `Content-Type` d'un objet déjà stocké, sans recopier les octets côté client
   * (`CopyObject` sur lui-même + `MetadataDirective: REPLACE`).
   *
   * Indispensable pour l'upload par PUT présigné : le `ContentType` passé à la signature
   * **ne fait pas partie des en-têtes signés** (`X-Amz-SignedHeaders=host`), le navigateur
   * peut donc envoyer le type qu'il veut. C'est ici, côté serveur, que le type réellement
   * stocké est arrêté. Sans objet pour l'upload multipart, dont le type est fixé par
   * `CreateMultipartUpload` — un appel serveur, lui, autoritatif.
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
   * URL présignée pour le serving direct (lecture) d'un média.
   *
   * `contentTypeOverride` impose le `Content-Type` de la RÉPONSE, quel que soit le type
   * stocké. Indispensable partout où l'objet n'a pas de passage serveur après l'upload
   * (pièces jointes, avatars, logo, PDF de documentation) : le type déposé y vient du
   * navigateur et n'est donc pas fiable. Le paramètre voyage dans la signature — le client
   * ne peut ni le retirer ni le changer sans invalider l'URL.
   *
   * **À défaut de type explicite, le type est déduit de la clé** (`responseTypeFromKey`) :
   * ne rien imposer revenait à servir l'objet avec le type que son déposant avait choisi,
   * et les quatre surfaces qui n'ont pas de passage serveur après le dépôt le faisaient.
   * De même, `ttlSeconds` omis retient la durée qui va à la nature du contenu
   * (`defaultGetTtl`), et non une heure pour tout le monde.
   *
   * L'URL est **stable pendant une tranche de `PRESIGN_WINDOW_SECONDS`** : à clé, type
   * imposé et durée identiques, deux appels rendent la même chaîne, donc le navigateur
   * réutilise son cache au lieu de retélécharger. La stabilité vaut aussi entre processus
   * (API et worker) parce que la date de signature est épinglée au début de la tranche et
   * non prise à l'instant de l'appel.
   */
  async getPresignedGetUrl(key: string, ttlSeconds?: number, contentTypeOverride?: string): Promise<string> {
    const ttl = ttlSeconds ?? defaultGetTtl(key);
    const imposed = contentTypeOverride ?? responseTypeFromKey(key);
    const slot = Math.floor(Date.now() / 1000 / PRESIGN_WINDOW_SECONDS);
    // Changement de tranche : plus aucune de ces URL ne sera reproduite, on repart à vide.
    if (slot !== this.presignSlot) {
      this.presignCache.clear();
      this.presignSlot = slot;
    }
    // Clé non ambiguë : un type imposé ou un nom de fichier peut contenir n'importe quel
    // caractère, on sérialise donc les trois champs plutôt que de les coller bout à bout.
    // Les valeurs RÉSOLUES : demander le défaut ou le redemander explicitement, c'est la
    // même URL, elle ne doit pas être signée deux fois.
    const cacheKey = JSON.stringify([ttl, imposed, key]);
    const hit = this.presignCache.get(cacheKey);
    if (hit) return hit.url;

    const url = this.signGetUrl(key, ttl, slot, imposed);
    this.presignCache.set(cacheKey, { objectKey: key, url });
    // Une signature en échec ne doit pas rester mémorisée — et l'attente de ce rejet ici
    // évite un « unhandled rejection » si l'appelant, lui, a déjà traité l'erreur.
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
   * Signature d'une lecture, datée du début de la tranche `slot`.
   *
   * La validité demandée est majorée de la largeur de la tranche : une URL rendue à la
   * toute fin d'une tranche reste valable au moins aussi longtemps que ce que l'appelant
   * a demandé — la mémoïsation ne raccourcit donc jamais la durée de vie d'un lien.
   */
  private signGetUrl(key: string, ttlSeconds: number, slot: number, contentType: string): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Second filtre : même un type explicitement passé par un appelant peut venir du
      // client (pièce jointe, fichier de board), il repasse donc par la liste blanche.
      ResponseContentType: safeUploadContentType(contentType),
    });
    return getSignedUrl(this.publicClient, cmd, {
      expiresIn: ttlSeconds + PRESIGN_WINDOW_SECONDS,
      signingDate: new Date(slot * PRESIGN_WINDOW_SECONDS * 1000),
    });
  }

  /**
   * Oublie l'URL mémorisée d'un objet.
   *
   * À appeler après toute réécriture d'un objet **sous la même clé** faite hors de ce
   * service — typiquement un dépôt navigateur par URL présignée (avatar, vignette
   * d'entité). Sans cela, l'URL rendue resterait identique jusqu'à la fin de la tranche,
   * donc le navigateur continuerait d'afficher l'ancienne image depuis son cache.
   * Les écritures qui passent par ce service (`putObject`, `copyObject`,
   * `setObjectContentType`, suppressions) s'oublient toutes seules.
   */
  forgetPresignedUrl(key: string): void {
    for (const [cacheKey, entry] of this.presignCache) {
      if (entry.objectKey === key) this.presignCache.delete(cacheKey);
    }
  }

  /** Variante préfixe, pour les suppressions en masse (tout un média, toute une version). */
  private forgetPresignedPrefix(prefix: string): void {
    for (const [cacheKey, entry] of this.presignCache) {
      if (entry.objectKey.startsWith(prefix)) this.presignCache.delete(cacheKey);
    }
  }

  /**
   * Écriture serveur → MinIO (avatars, dérivés générés par les workers).
   *
   * Le type passe par la même liste blanche que les autres chemins d'écriture : « serveur »
   * ne veut pas dire « de confiance ». Une pièce jointe ou un média rapatriés d'un site
   * ShotGrid arrivent ici avec le `Content-Type` annoncé par ce site — `text/html` ou
   * `image/svg+xml` y sont donc possibles, et l'objet est servi depuis l'origine de
   * l'application. Les types réellement produits par les workers (mp4, jpeg, playlists HLS)
   * sont dans la liste ; les formats binaires (GLB, masques splat) tombent, comme il se
   * doit, sur `application/octet-stream`.
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
    // Le worker réécrit une miniature sous la même clé : sans cet oubli, la carte
    // continuerait d'afficher l'ancienne image jusqu'à la fin de la tranche.
    this.forgetPresignedUrl(key);
  }

  /** Lecture d'un objet en flux. */
  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  /**
   * Objet complet en mémoire. Réservé aux contenus dont la taille est maîtrisée
   * (vignettes, envois vers une API tierce qui exige un corps unique) : pour tout ce
   * qui peut peser lourd, préférer `getObjectStream` ou `downloadToFile`.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = await this.getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
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
    this.forgetPresignedUrl(key);
  }

  /**
   * Suppression multiple (`DeleteObjects`), jusqu'à `DELETE_OBJECTS_BATCH` clés par appel.
   *
   * Vider la corbeille de deux cents médias supprimait jusqu'ici les objets un par un, en
   * série, dans le fil de la requête HTTP : quatre cents allers-retours MinIO là où le
   * protocole en propose un seul. S3 borne l'appel à 1 000 clés, d'où le découpage.
   *
   * Renvoie les clés que le stockage a REFUSÉES (élément `Errors` de la réponse) plutôt que
   * de lever : une suppression partielle est un fait normal ici, et l'appelant a besoin de
   * la liste exacte pour enfiler un retry. Une panne de transport, elle, est propagée —
   * c'est la même règle que `deleteObject`.
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
    // Un seul balayage du cache pour tout le lot : `forgetPresignedUrl` par clé coûterait
    // ici mille parcours d'une table de cinq mille entrées.
    this.forgetPresignedKeys(new Set(keys));
    return refused;
  }

  /** Oubli groupé : un seul parcours du cache pour un lot de clés supprimées. */
  private forgetPresignedKeys(keys: Set<string>): void {
    if (keys.size === 0) return;
    for (const [cacheKey, entry] of this.presignCache) {
      if (keys.has(entry.objectKey)) this.presignCache.delete(cacheKey);
    }
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
    this.forgetPresignedPrefix(prefix);
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
  /**
   * Vignette choisie à la main pour une séquence, un plan ou un asset (C3). La colonne
   * `thumbnailKey` et le PATCH existaient depuis longtemps, mais rien ne savait produire
   * la clé : aucune entité n'a jamais pu porter d'image.
   */
  static entityThumbnailKey(holder: 'sequence' | 'shot' | 'asset', id: number, ext: string): string {
    return `entity-thumbs/${holder}/${id}${ext}`;
  }

  /**
   * Image d'un département. Même forme de clé, même préfixe réservé : elle ne dépend
   * que de l'identifiant et de l'extension, donc remplacer l'image réécrit le même
   * objet — et le client ne peut pas faire pointer un département ailleurs.
   */
  static departmentImageKey(id: number, ext: string): string {
    return `entity-thumbs/department/${id}${ext}`;
  }
}

export const storage = new StorageService();
export { StorageService };
