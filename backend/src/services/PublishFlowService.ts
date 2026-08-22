// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, Role, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { parsePipelinePath } from '../lib/pipelinePath';
import {
  getExtension,
  inferKindFromExtension,
  isSupportedExtension,
  SUPPORTED_EXTENSIONS,
} from '../lib/fileSignatures';
import { looksLikeSequencePattern } from '../lib/imageSequence';
import { versionSelect, mediaSelect, toVersion, toMedia } from '../lib/v1Resources';
import * as MediaService from './MediaService';
import * as Ensure from './PipelineEnsureService';
import * as Resolve from './PipelineResolveService';
import * as VersionService from './VersionService';
import * as ApiEventService from './ApiEventService';
import type { UsdRequest } from './ModelConvertService';
import { enqueuePush } from './shotgrid/ShotgridPushService';

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

/**
 * Type de média déduit de l'extension. Explicite l'échec plutôt que de deviner au hasard.
 *
 * La table vit dans `lib/fileSignatures` (`SUPPORTED_EXTENSIONS`), à côté des signatures
 * qui la font tenir. Elle était auparavant recopiée ici, et la copie avait dérivé : sept
 * extensions image (`.exr .dpx .tif .tiff .tga .bmp .gif`) et trois vidéo (`.avi .mxf
 * .m4v`) étaient annoncées — jusque dans la documentation de l'API v1 — alors qu'aucune
 * n'était reconnue à la finalisation. Un rendu de plusieurs gigaoctets montait
 * intégralement avant d'être refusé. Une seule liste, donc, et le refus au plus tôt.
 */
export function inferMediaKind(filename: string): MediaKind {
  const kind = inferKindFromExtension(getExtension(filename));
  if (!kind) {
    throw badRequest(`Cannot tell the media kind of « ${filename} » — pass « kind »`, 'KIND_UNKNOWN');
  }
  return kind;
}

/**
 * Refus **avant** l'envoi du fichier.
 *
 * C'est tout l'intérêt de la publication en deux temps : le client ne transfère rien tant
 * que `start` n'a pas répondu. Un format non lisible refusé ici coûte un aller-retour ;
 * refusé à la finalisation, il coûte le transfert complet du master.
 */
function assertExtensionSupported(kind: MediaKind, filename: string): void {
  const ext = getExtension(filename);
  if (isSupportedExtension(kind, ext)) return;
  throw badRequest(
    `« ${filename} » cannot be read as ${kind} — accepted: ${SUPPORTED_EXTENSIONS[kind].join(', ')}`,
    'UNSUPPORTED_FORMAT',
  );
}

/**
 * Une séquence d'images ne se publie pas par ce chemin — et il faut le dire.
 *
 * `SH0100_comp_v003.%04d.exr` passerait tous les contrôles ci-dessus : l'extension est
 * `.exr`, donc IMAGE, donc acceptée. Le DCC obtiendrait une URL présignée, y déposerait
 * une frame — ou rien — et créerait un média nommé d'après un motif, muet et inutilisable.
 * Un envoi de séquence demande N URLs, une reprise et un assemblage : c'est
 * `POST /api/media/sequence/init` (vague 5), pas la publication en deux temps.
 *
 * Refus explicite plutôt que chemin qui échoue en silence : c'est exactement la faute que
 * la vague précédente a corrigée sur les extensions annoncées et non reconnues.
 */
function assertNotSequencePattern(filename: string): void {
  if (!looksLikeSequencePattern(filename)) return;
  throw badRequest(
    `« ${filename} » is an image sequence pattern — publish it through /api/media/sequence/init`,
    'SEQUENCE_NOT_SUPPORTED_HERE',
  );
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
  /**
   * Scène USD : variantes et purpose à convertir. Réservé à `MODEL_3D`.
   * Sans lui, la conversion part sur les valeurs par défaut et il faut ensuite recomposer.
   */
  usd?: UsdRequest;
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
    throw badRequest('The path must point to at least one shot or asset', 'PATH_TOO_SHALLOW');
  }
  if (parsed.version) {
    throw badRequest(
      'Le chemin ne doit pas inclure la version — utiliser « versionName »',
      'PATH_INCLUDES_VERSION',
    );
  }

  assertNotSequencePattern(input.filename);

  const project = await Resolve.resolveProject(parsed.project);
  const kind = input.kind ?? inferMediaKind(input.filename);
  // Un `kind` imposé par le client ne dispense pas du contrôle : c'est justement le cas où
  // l'extension et le type annoncé peuvent diverger.
  assertExtensionSupported(kind, input.filename);
  if (input.usd && kind !== MediaKind.MODEL_3D) {
    // Refus explicite plutôt qu'oubli silencieux : un client qui croit piloter la conversion
    // d'un .mov doit l'apprendre tout de suite, pas en relisant les métadonnées.
    throw badRequest("« usd » ne s'applique qu'aux médias 3D", 'USD_NOT_3D');
  }

  // Cible : la tâche si le chemin en nomme une, sinon l'asset lui-même.
  const target = input.createMissing
    ? await Ensure.ensurePath({ id: actor.id, role: actor.role }, project.id, input.path, {
        shot: input.shot,
      })
    : await resolveExistingTarget(project.id, input.path);

  const parent = target.taskId !== undefined ? { taskId: target.taskId } : { assetId: target.assetId };
  if (parent.taskId === undefined && parent.assetId === undefined) {
    throw badRequest('Path holds no usable task or asset', 'PATH_NO_TARGET');
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
    // La sélection n'est pas filtrée ici : à la publication, les variantSets de la scène ne
    // sont pas encore connus (l'analyse USD n'a pas eu lieu). Ce n'est pas un trou —
    // `ModelConvertService.convertUsd` la passe à `sanitizeVariantSelection` contre les
    // variantSets réellement lus, donc une valeur inventée n'atteint jamais le pipeline.
    usdRequest: input.usd,
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
  if (resolved.projectId !== projectId) throw notFound('Path lies outside the resolved project');
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
  if (!media) throw notFound('Media not found');

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

  // 48 : une publication ReView crée sa Version côté ShotGrid (lien ou fichier selon
  // le réglage du projet). Mise en file — l'artiste n'attend pas le site distant.
  if (shouldPublish) {
    const projectId = await resolveProjectIdForVersion(media.versionId);
    if (projectId)
      await enqueuePush(projectId, {
        type: 'version-publish',
        versionId: media.versionId,
        actorId: actor.id,
      });
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
