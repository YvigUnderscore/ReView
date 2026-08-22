// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { createUpload } from './MediaService';
import { logAudit } from './AuditService';
import { enqueueMediaJob } from './JobService';
import { badRequest, notFound } from '../lib/errors';
import { checkProjectAccess } from '../middleware/rbac';
import { validateMediaHeader } from '../lib/fileSignatures';
import { OPAQUE_CONTENT_TYPE } from '../lib/uploadContentType';
import { resolveEntitySettings, resolveProjectSettingsById } from '../lib/projectSettings';
import { assertProjectQuota } from '../lib/projectQuota';
import { getNumericSetting, SETTING_KEYS } from '../lib/settings';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import {
  isSafeFrameName,
  MAX_SEQUENCE_FRAMES,
  MIN_SEQUENCE_FRAMES,
  parseFrameName,
  parseFramePattern,
  sequenceFrameKey,
  sequenceFramePrefix,
  sequenceManifestKey,
  sequenceSummary,
  type SequenceManifest,
} from '../lib/imageSequence';

/**
 * Transport d'une séquence d'images : N fichiers, UN média.
 *
 * Le multipart résumable (`MediaUploadService`) découpe **un** fichier en parts ; ici c'est
 * l'inverse — mille fichiers entiers doivent former un seul média. Le parallélisme, la
 * reprise et l'annulation sont donc rejoués à l'échelle de la frame :
 *
 *   1. `initSequence` — crée le média porteur (VIDEO, UPLOADING) et la ligne `ImageSequence`,
 *      ou **retrouve** celui d'un envoi interrompu. Les frames déjà déposées sont listées
 *      depuis MinIO : le stockage fait foi, le client n'a aucun état à conserver.
 *   2. `frameUploadUrls` — URLs présignées par lots ; le client en envoie plusieurs de front.
 *   3. `completeSequence` — vérifie ce qui est réellement arrivé, écrit le manifeste, et
 *      enfile l'assemblage. C'est ici que se joue le rôle de `MediaService.finalize`, qui ne
 *      sait valider qu'un objet unique.
 *   4. `listSequenceFrames` — le livrable d'origine, frame par frame, en URLs présignées.
 */

type SessionUser = { id: number; role: Role };

/** URLs présignées demandées d'un coup : borne le coût de signature d'un aller-retour. */
export const FRAME_URL_BATCH_MAX = 64;

/**
 * Durée de vie des URLs de téléchargement du livrable d'origine.
 *
 * Récupérer mille EXR de 50 Mo prend du temps, même à quatre connexions : une heure ne
 * suffit pas toujours, et la liste entière serait à redemander en cours de route.
 */
const FRAME_URL_TTL_SEC = 6 * 3600;

/**
 * Frames dont l'en-tête est réellement relu à la finalisation.
 *
 * Relire les 32 premiers octets de trois mille objets coûterait trois mille requêtes pour
 * une garantie que le listing donne déjà en une : chaque frame existe et n'est pas vide.
 * On relit donc la première, celle du milieu et la dernière — assez pour attraper le cas
 * réel (un dossier de PNG déposé sous une extension `.exr`, une livraison tronquée en tête
 * ou en queue), sans transformer la finalisation en balayage complet du bucket.
 */
const HEADER_CHECK_POSITIONS = 3;

export interface InitSequenceInput {
  versionId: number;
  /** Motif FFmpeg (`SH0100_comp_v003.%04d.exr`) — c'est le nom du média. */
  pattern: string;
  /** Fichiers du lot : nom livré et taille annoncée. */
  frames: { name: string; size: number }[];
  /** Cadence imposée par l'utilisateur ; sinon héritée du pipeline du plan. */
  framerate?: number;
}

/** Métadonnée de reprise : distingue une séquence en cours d'un upload multipart. */
interface SequenceMeta {
  sequencePending?: boolean;
  [key: string]: unknown;
}

/**
 * Cadence d'assemblage : héritage studio→projet→séquence→shot, exactement celui que
 * l'administration affiche. Une séquence d'images n'a pas de cadence intrinsèque — la lui
 * inventer (24 en dur) produirait un plan qui ne dure pas ce qu'il doit durer.
 */
export async function resolveSequenceFramerate(versionId: number, projectId: number): Promise<number> {
  const project = await resolveProjectSettingsById(projectId);
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      task: { select: { shot: { select: { settings: true, sequence: { select: { settings: true } } } } } },
    },
  });
  const shot = version?.task?.shot ?? null;
  return resolveEntitySettings(project, shot?.sequence?.settings, shot?.settings).framerate;
}

/** Contrôles de forme du lot, avant toute écriture : refuser tôt, jamais après le transfert. */
function assertSequenceShape(input: InitSequenceInput): { extension: string; digits: number } {
  const parsed = parseFramePattern(input.pattern);
  if (!parsed) throw badRequest('Not an image sequence pattern (expected « name.%04d.ext »)', 'BAD_PATTERN');
  if (input.frames.length < MIN_SEQUENCE_FRAMES)
    throw badRequest('An image sequence needs at least two frames', 'SEQUENCE_TOO_SHORT');
  if (input.frames.length > MAX_SEQUENCE_FRAMES)
    throw badRequest(
      `An image sequence is capped at ${String(MAX_SEQUENCE_FRAMES)} frames`,
      'SEQUENCE_TOO_LONG',
    );

  const seen = new Set<string>();
  for (const frame of input.frames) {
    if (!isSafeFrameName(frame.name))
      throw badRequest(`Frame name rejected: « ${frame.name} »`, 'BAD_FRAME_NAME');
    if (seen.has(frame.name)) throw badRequest(`Frame sent twice: « ${frame.name} »`, 'DUPLICATE_FRAME');
    seen.add(frame.name);
    const named = parseFrameName(frame.name);
    if (!named || named.extension !== parsed.extension || named.digits !== parsed.digits)
      throw badRequest(`« ${frame.name} » does not match ${input.pattern}`, 'FRAME_OUTSIDE_PATTERN');
  }
  return parsed;
}

/** Numéros de frame du lot, dans l'ordre, appariés à leur nom de fichier. */
function orderedFrames(input: InitSequenceInput): { frame: number; name: string; size: number }[] {
  return input.frames
    .map((f) => ({ frame: parseFrameName(f.name)!.number, name: f.name, size: f.size }))
    .sort((a, b) => a.frame - b.frame);
}

/**
 * Ouvre (ou reprend) l'envoi d'une séquence.
 *
 * La reprise ne s'appuie sur rien que le client détiendrait : même version, même compte,
 * même motif, statut UPLOADING — et la liste des frames déjà en place est relue dans MinIO.
 * Fermer l'onglet au milieu d'une livraison de 80 Go ne coûte donc que les frames en vol.
 */
export async function initSequence(user: SessionUser, input: InitSequenceInput) {
  const { extension, digits } = assertSequenceShape(input);
  const frames = orderedFrames(input);
  const summary = sequenceSummary(frames.map((f) => f.frame));
  const declaredSize = frames.reduce((acc, f) => acc + Math.max(0, f.size), 0);

  const pending = await prisma.mediaObject.findFirst({
    where: {
      uploaderId: user.id,
      versionId: input.versionId,
      originalName: input.pattern,
      status: MediaStatus.UPLOADING,
      imageSequence: { isNot: null },
    },
    include: { imageSequence: true },
    orderBy: { id: 'desc' },
  });
  if (pending?.imageSequence) {
    return {
      mediaObjectId: pending.id,
      resumed: true,
      framerate: pending.imageSequence.framerate,
      uploadedFrames: await listUploadedFrameNames(pending.imageSequence.storagePrefix),
      namingWarning: false,
    };
  }

  // Une frame de 2 Go n'existe pas : le plafond de taille de fichier s'applique au lot
  // entier, faute de quoi la limite du studio serait contournable en la découpant.
  const maxFileSize = await getNumericSetting(SETTING_KEYS.MAX_FILE_SIZE);
  if (declaredSize > maxFileSize) throw badRequest('Image sequence is too large', 'FILE_TOO_LARGE');

  // Tous les garde-fous d'un upload ordinaire (accès, contribution, projet archivé, quotas,
  // nomenclature, héritage de publication) sont ceux de `createUpload` : on l'appelle plutôt
  // que d'en écrire une seconde version, qui aurait dérivé. L'URL présignée qu'il renvoie ne
  // sert pas ici — une séquence n'a pas d'objet unique à déposer.
  const created = await createUpload(user, {
    versionId: input.versionId,
    filename: input.pattern,
    contentType: 'application/json',
    kind: MediaKind.VIDEO,
    size: declaredSize,
  });

  const projectId = await resolveProjectIdForVersion(input.versionId);
  const framerate =
    input.framerate ?? (projectId ? await resolveSequenceFramerate(input.versionId, projectId) : 24);
  const manifestKey = sequenceManifestKey(created.storageKey);
  const storagePrefix = sequenceFramePrefix(created.storageKey);

  await prisma.$transaction([
    prisma.mediaObject.update({
      where: { id: created.mediaObjectId },
      data: { storageKey: manifestKey, metadata: { sequencePending: true } },
    }),
    prisma.imageSequence.create({
      data: {
        mediaObjectId: created.mediaObjectId,
        pattern: input.pattern,
        extension,
        digits,
        startFrame: summary.startFrame,
        endFrame: summary.endFrame,
        frameCount: summary.frameCount,
        framerate,
        storagePrefix,
      },
    }),
  ]);

  return {
    mediaObjectId: created.mediaObjectId,
    resumed: false,
    framerate,
    uploadedFrames: [] as string[],
    namingWarning: created.namingWarning ?? false,
  };
}

/** Frames déjà présentes sous le préfixe (le stockage fait foi, comme ListParts en multipart). */
async function listUploadedFrameNames(prefix: string): Promise<string[]> {
  const names: string[] = [];
  for await (const object of storage.iterateObjects(prefix)) {
    if (object.size > 0) names.push(object.key.slice(prefix.length));
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/** Charge une séquence en cours d'envoi appartenant à l'appelant. */
async function loadOwnSequence(user: SessionUser, id: number, status: MediaStatus) {
  const media = await prisma.mediaObject.findFirst({
    where: { id, uploaderId: user.id, status },
    include: { imageSequence: true },
  });
  if (!media?.imageSequence) throw notFound('Image sequence upload not found');
  return { media, sequence: media.imageSequence };
}

/** URLs présignées d'un lot de frames. Les noms sont revalidés : ils composent une clé. */
export async function frameUploadUrls(user: SessionUser, id: number, names: string[]) {
  const { sequence } = await loadOwnSequence(user, id, MediaStatus.UPLOADING);
  const urls = await Promise.all(
    names.map(async (name) => {
      if (!isSafeFrameName(name)) throw badRequest(`Frame name rejected: « ${name} »`, 'BAD_FRAME_NAME');
      const parsed = parseFrameName(name);
      if (!parsed || parsed.extension !== sequence.extension)
        throw badRequest(`« ${name} » does not belong to ${sequence.pattern}`, 'FRAME_OUTSIDE_PATTERN');
      return {
        name,
        // Type neutre : l'objet est servi depuis l'origine de l'application, et le
        // presigner ne signe pas l'en-tête — c'est le serveur qui arrête le type, jamais
        // le navigateur (cf. `lib/uploadContentType`).
        url: await storage.getPresignedPutUrl(
          sequenceFrameKey(sequence.storagePrefix, name),
          'application/octet-stream',
        ),
      };
    }),
  );
  return { urls };
}

/**
 * Clôt l'envoi : ce qui est réellement arrivé fait foi.
 *
 * Le listing MinIO donne d'un coup l'existence, la taille et le compte ; trois en-têtes
 * relus attrapent le format menti. Une séquence dont il manque des frames n'est pas
 * refusée — c'est une livraison partielle légitime — mais le compte et les bornes écrits en
 * base sont ceux du réel, jamais ceux annoncés à l'ouverture.
 */
export async function completeSequence(user: SessionUser, id: number) {
  const { media, sequence } = await loadOwnSequence(user, id, MediaStatus.UPLOADING);

  const objects: { name: string; size: number }[] = [];
  for await (const object of storage.iterateObjects(sequence.storagePrefix)) {
    if (object.size > 0)
      objects.push({ name: object.key.slice(sequence.storagePrefix.length), size: object.size });
  }
  const frames = objects
    .map((o) => ({ ...o, frame: parseFrameName(o.name)?.number }))
    .filter((o): o is { name: string; size: number; frame: number } => o.frame !== undefined)
    .sort((a, b) => a.frame - b.frame);
  if (frames.length < MIN_SEQUENCE_FRAMES)
    throw badRequest('No frame reached storage for this image sequence', 'SEQUENCE_EMPTY');

  await assertFrameHeaders(sequence.storagePrefix, sequence.extension, frames);

  const totalSize = frames.reduce((acc, f) => acc + f.size, 0);
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (projectId) await assertProjectQuota(projectId, totalSize);

  const summary = sequenceSummary(frames.map((f) => f.frame));
  const manifest: SequenceManifest = {
    kind: 'image-sequence',
    pattern: sequence.pattern,
    extension: sequence.extension,
    digits: sequence.digits,
    startFrame: summary.startFrame,
    endFrame: summary.endFrame,
    frameCount: summary.frameCount,
    framerate: sequence.framerate,
    totalSize,
    prefix: sequence.storagePrefix,
    frames: frames.map((f) => ({ frame: f.frame, name: f.name, size: f.size })),
  };
  await storage.putObject(media.storageKey, Buffer.from(JSON.stringify(manifest)), 'application/json');

  const metadata: SequenceMeta = { ...(media.metadata as SequenceMeta) };
  delete metadata.sequencePending;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.imageSequence.update({
      where: { mediaObjectId: id },
      data: {
        startFrame: summary.startFrame,
        endFrame: summary.endFrame,
        frameCount: summary.frameCount,
        totalSize: BigInt(totalSize),
      },
    });
    return tx.mediaObject.update({
      where: { id },
      data: {
        status: MediaStatus.PROCESSING,
        size: BigInt(totalSize),
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  });

  if (media.uploaderId) {
    await prisma.user.update({
      where: { id: media.uploaderId },
      data: { storageUsed: { increment: BigInt(totalSize) } },
    });
  }
  await enqueueMediaJob({ mediaObjectId: id, kind: 'transcode' });
  logAudit({
    userId: user.id,
    action: 'MEDIA_SEQUENCE_UPLOAD',
    entityType: 'MediaObject',
    entityId: id,
    metadata: { pattern: sequence.pattern, frameCount: summary.frameCount, totalSize },
  });
  return {
    media: { id: updated.id, status: updated.status, size: totalSize },
    startFrame: summary.startFrame,
    endFrame: summary.endFrame,
    frameCount: summary.frameCount,
    missingFrames: summary.missingFrames,
  };
}

/** Relit l'en-tête de trois frames et refuse le lot si l'une n'est pas l'image annoncée. */
async function assertFrameHeaders(
  prefix: string,
  extension: string,
  frames: { name: string; size: number }[],
): Promise<void> {
  const positions = new Set([0, Math.floor(frames.length / 2), frames.length - 1]);
  for (const index of [...positions].slice(0, HEADER_CHECK_POSITIONS)) {
    const frame = frames[index]!;
    const header = await storage.getObjectHeader(sequenceFrameKey(prefix, frame.name), 32);
    if (!validateMediaHeader(MediaKind.IMAGE, header, extension, frame.size))
      throw badRequest(`« ${frame.name} » is not a readable ${extension} image`, 'INVALID_FILE');
  }
}

/**
 * Le livrable d'origine, frame par frame.
 *
 * Une séquence de mille EXR ne se rezippe pas à la volée dans le processus web : l'archive
 * ferait cent gigaoctets et occuperait une connexion pendant une heure. On rend donc le
 * manifeste et les URLs présignées, que n'importe quel client (navigateur, `curl`, outil de
 * studio) télécharge en parallèle — et sous leur nom d'origine, puisque c'est lui qui a
 * servi de clé.
 */
export async function listSequenceFrames(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    include: { imageSequence: true },
  });
  if (!media?.imageSequence) throw notFound('Media has no image sequence');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media has no image sequence');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw notFound('Media has no image sequence');

  const sequence = media.imageSequence;
  const objects: { name: string; size: number }[] = [];
  for await (const object of storage.iterateObjects(sequence.storagePrefix)) {
    if (object.size > 0)
      objects.push({ name: object.key.slice(sequence.storagePrefix.length), size: object.size });
  }
  objects.sort((a, b) => (parseFrameName(a.name)?.number ?? 0) - (parseFrameName(b.name)?.number ?? 0));
  const frames = await Promise.all(
    objects.map(async (o) => ({
      frame: parseFrameName(o.name)?.number ?? 0,
      name: o.name,
      size: o.size,
      // Type de réponse imposé, et opaque : la signature du PUT ne couvre pas l'en-tête,
      // une frame a donc pu être déposée en `text/html`. Ces objets sont servis depuis
      // l'origine de l'application (nginx expose MinIO sous `/<bucket>/…`) — rendus, ils
      // exécuteraient du script avec le jeton de session. Aucune frame n'a de raison
      // d'être affichée par le navigateur : elles se téléchargent.
      url: await storage.getPresignedGetUrl(
        sequenceFrameKey(sequence.storagePrefix, o.name),
        FRAME_URL_TTL_SEC,
        OPAQUE_CONTENT_TYPE,
      ),
    })),
  );
  return {
    pattern: sequence.pattern,
    startFrame: sequence.startFrame,
    endFrame: sequence.endFrame,
    framerate: sequence.framerate,
    totalSize: Number(sequence.totalSize),
    frames,
  };
}
