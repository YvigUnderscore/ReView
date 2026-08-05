// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, Role, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { parsePipelinePath } from '../lib/pipelinePath';
import { versionSelect, mediaSelect, toVersion, toMedia } from '../lib/v1Resources';
import * as MediaService from './MediaService';
import * as Ensure from './PipelineEnsureService';
import * as Resolve from './PipelineResolveService';
import * as VersionService from './VersionService';
import * as ApiEventService from './ApiEventService';

/**
 * Publication depuis un DCC en deux appels (API v1).
 *
 * Publier un playblast demandait jusqu'ici de connaître les identifiants du shot, de la
 * tâche et de la version, puis d'enchaîner création de version, demande d'URL, envoi et
 * finalisation : cinq allers-retours et autant d'occasions de rester à mi-chemin. Ici :
 *
 *   1. `start` — un chemin (`PROJ/SQ010/SH0100/anim`) et un nom de fichier suffisent.
 *      Ce qui manque dans la hiérarchie est créé, la version est ouverte, une URL d'envoi
 *      présignée est renvoyée.
 *   2. `complete` — après le PUT du fichier : validation du contenu, traitement, et
 *      publication si demandée.
 *
 * Le découpage en deux est imposé par l'envoi direct vers le stockage objet : le fichier
 * ne transite jamais par l'API, ce qui est précisément ce qui rend viable l'envoi d'un
 * rendu de plusieurs gigaoctets.
 */

type Actor = { id: number; role: Role; email: string };

/** Extensions reconnues, par type de média — sert à déduire `kind` quand il est tu. */
const KIND_BY_EXTENSION: [RegExp, MediaKind][] = [
  [/\.(mov|mp4|mkv|avi|webm|mxf|m4v)$/i, MediaKind.VIDEO],
  [/\.(jpg|jpeg|png|tif|tiff|exr|dpx|webp|gif|bmp|tga)$/i, MediaKind.IMAGE],
  [/\.(glb|gltf|fbx|obj|usd|usda|usdc|usdz|dae|stl|abc|zip)$/i, MediaKind.MODEL_3D],
  [/\.(splat|ply|ksplat|spz)$/i, MediaKind.SPLAT],
];

/** Type de média déduit de l'extension. Explicite l'échec plutôt que de deviner au hasard. */
export function inferMediaKind(filename: string): MediaKind {
  const found = KIND_BY_EXTENSION.find(([re]) => re.test(filename));
  if (!found) {
    throw badRequest(`Type de média indéterminable pour « ${filename} » — préciser « kind »`, 'KIND_UNKNOWN');
  }
  return found[1];
}

export interface StartPublishInput {
  /** Chemin cible, jusqu'à la tâche ou l'asset (`PROJ/SQ010/SH0100/anim`). */
  path: string;
  filename: string;
  contentType?: string;
  kind?: MediaKind;
  size?: number;
  contentHash?: string;
  /** Nom de version imposé. Absent : la suivante est calculée (V01, V02…). */
  versionName?: string;
  /** Réutiliser la version si elle existe déjà, au lieu d'échouer. */
  reuseVersion?: boolean;
  /** Créer les maillons manquants du chemin (séquence, shot, tâche). */
  createMissing?: boolean;
  /** Cadrage du shot, posé à la création seulement. */
  shot?: { name?: string; startFrame?: number; endFrame?: number };
}

/** Devine un type MIME raisonnable quand le client n'en fournit pas. */
const CONTENT_TYPE_FALLBACK: Record<MediaKind, string> = {
  [MediaKind.VIDEO]: 'video/mp4',
  [MediaKind.IMAGE]: 'image/png',
  [MediaKind.MODEL_3D]: 'application/octet-stream',
  [MediaKind.SPLAT]: 'application/octet-stream',
};

/**
 * Ouvre une publication : hiérarchie, version, et URL d'envoi.
 * `projectId` est résolu ici et renvoyé pour que la route valide l'accès AVANT toute
 * écriture — c'est l'appelant qui garde la main sur le contrôle d'accès.
 */
export async function start(actor: Actor, input: StartPublishInput) {
  const parsed = parsePipelinePath(input.path);
  if (parsed.kind === 'project' || parsed.kind === 'sequence') {
    throw badRequest('Le chemin doit désigner au moins un shot ou un asset', 'PATH_TOO_SHALLOW');
  }
  if (parsed.version) {
    throw badRequest(
      'Le chemin ne doit pas inclure la version — utiliser « versionName »',
      'PATH_INCLUDES_VERSION',
    );
  }

  const project = await Resolve.resolveProject(parsed.project);
  const kind = input.kind ?? inferMediaKind(input.filename);

  // Cible : la tâche si le chemin en nomme une, sinon l'asset lui-même.
  const target = input.createMissing
    ? await Ensure.ensurePath({ id: actor.id, role: actor.role }, project.id, input.path, {
        shot: input.shot,
      })
    : await resolveExistingTarget(project.id, input.path);

  const parent = target.taskId !== undefined ? { taskId: target.taskId } : { assetId: target.assetId };
  if (parent.taskId === undefined && parent.assetId === undefined) {
    throw badRequest('Chemin sans tâche ni asset exploitable', 'PATH_NO_TARGET');
  }

  const version = await Ensure.ensureVersion({ id: actor.id, role: actor.role }, project.id, parent, {
    name: input.versionName,
    reuseExisting: input.reuseVersion,
  });

  const upload = await MediaService.createUpload(actor, {
    versionId: version.entity.id,
    filename: input.filename,
    contentType: input.contentType ?? CONTENT_TYPE_FALLBACK[kind],
    kind,
    size: input.size,
    contentHash: input.contentHash,
  });

  if (version.created) {
    ApiEventService.publish('version.created', {
      projectId: project.id,
      entityType: 'version',
      entityId: version.entity.id,
      actorId: actor.id,
      payload: { version: toVersion(version.entity), path: input.path },
    });
  }

  return {
    projectId: project.id,
    version: toVersion(version.entity),
    versionCreated: version.created,
    created: 'created' in target ? target.created : [],
    mediaId: upload.mediaObjectId,
    uploadUrl: upload.uploadUrl,
    // L'envoi se fait en PUT direct sur cette URL, avec ce type de contenu.
    uploadMethod: 'PUT' as const,
    contentType: input.contentType ?? CONTENT_TYPE_FALLBACK[kind],
    namingWarning: upload.namingWarning,
  };
}

/** Résout une cible existante sans rien créer (mode strict). */
async function resolveExistingTarget(projectId: number, path: string) {
  const resolved = await Resolve.resolvePath(path);
  if (resolved.projectId !== projectId) throw notFound('Chemin hors du projet résolu');
  return {
    taskId: resolved.task?.id,
    assetId: resolved.task ? undefined : resolved.asset?.id,
  };
}

export interface CompletePublishInput {
  /** Publier le média et la version dans la foulée (défaut : oui). */
  publish?: boolean;
  /** Passer la version en REVIEW — la soumettre sans la publier. */
  submitForReview?: boolean;
}

/**
 * Clôt une publication : valide le fichier déposé, déclenche le traitement, publie.
 *
 * La publication de la *version* n'est tentée que si l'acteur en a le droit (superviseur+) :
 * un artiste publie son média — c'est le geste attendu — sans que l'appel échoue au motif
 * qu'il ne peut pas valider sa propre version.
 */
export async function complete(actor: Actor, mediaId: number, input: CompletePublishInput = {}) {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaId },
    select: { id: true, versionId: true, uploaderId: true },
  });
  if (!media) throw notFound('Média introuvable');

  const finalized = await MediaService.finalize(actor, mediaId);
  const shouldPublish = input.publish !== false;
  if (shouldPublish) await MediaService.publish(actor, mediaId);

  const isManager = actor.role === Role.ADMIN || actor.role === Role.SUPERVISOR;
  const nextStatus = shouldPublish && isManager ? VersionStatus.PUBLISHED : VersionStatus.REVIEW;
  if (shouldPublish || input.submitForReview) {
    const projectId = await resolveProjectIdForVersion(media.versionId);
    if (projectId) {
      await VersionService.update(actor, projectId, media.versionId, { status: nextStatus }).catch(
        () => undefined, // verrou de publication ou droits : le média reste publié, la version non
      );
    }
  }

  const version = await prisma.version.findUnique({
    where: { id: media.versionId },
    select: { ...versionSelect, media: { where: { deletedAt: null }, select: mediaSelect } },
  });

  return {
    media: toMedia({ ...finalized.media, size: BigInt(finalized.media.size) }),
    detectedExtension: finalized.detectedExtension,
    version: version ? toVersion(version) : null,
    published: shouldPublish,
  };
}
