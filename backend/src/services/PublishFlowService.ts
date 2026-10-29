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
import { setReviewers, type ReviewerInput } from './ReviewAssignmentService';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/**
 * Publishing from a DCC in two calls (API v1).
 *
 * Publishing a playblast used to require knowing the identifiers of the shot, the task and the version, then
 * chaining version creation, URL request, upload and finalization: five round trips and as many opportunities
 * to stop halfway. Here:
 *
 * 1. `start` — a path (`PROJ/SQ010/SH0100/anim`) and a file name suffice. What is missing from the hierarchy
 * is created, the version is opened, and a presigned
 *      upload URL is returned.
 *   2. `complete` — after the file's PUT: content validation, processing, and publication if requested.
 *
 * The split into two is imposed by the direct upload to object storage: the file never transits through the
 * API, which is precisely what makes uploading a multi-gigabyte render viable.
 */

type Actor = { id: number; role: Role; email: string };

/**
 * Media type deduced from the extension. Makes the failure explicit rather than guessing at random.
 *
 * The table lives in `lib/fileSignatures` (`SUPPORTED_EXTENSIONS`), next to the signatures that make it hold.
 * It used to be copied here, and the copy had drifted: seven image extensions (`.exr .dpx .tif .tiff .tga
 * .bmp .gif`) and three video ones (`.avi .mxf .m4v`) were announced — even in the API v1 documentation —
 * whereas none was recognised at finalization. A multi-gigabyte render was uploaded in full before being
 * refused. A single list, then, and the refusal as early as possible.
 */
export function inferMediaKind(filename: string): MediaKind {
  const kind = inferKindFromExtension(getExtension(filename));
  if (!kind) {
    throw badRequest(`Cannot tell the media kind of « ${filename} » — pass « kind »`, 'KIND_UNKNOWN');
  }
  return kind;
}

/**
 * Refusal **before** the file is sent.
 *
 * This is the whole point of two-step publication: the client transfers nothing until `start` has answered.
 * An unreadable format refused here costs one round trip; refused at finalization, it costs the full transfer
 * of the master.
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
 * An image sequence is not published through this path — and it must be said.
 *
 * `SH0100_comp_v003.%04d.exr` would pass all the format checks above: the extension is `.exr`, hence IMAGE,
 * hence accepted. The DCC would obtain a presigned URL, upload a frame — or nothing — there, and create a
 * media named after a pattern: silent, unusable, and discovered days later. Uploading a sequence requires N
 * URLs, a resume and an assembly: that is `POST /api/media/sequence/init` (wave 5), not the two-step
 * publication.
 *
 * Explicit refusal rather than a path that fails silently: exactly the fault that the previous wave corrected
 * on extensions announced but not recognised.
 */
function assertNotSequencePattern(filename: string): void {
  if (!looksLikeSequencePattern(filename)) return;
  throw badRequest(
    `« ${filename} » is an image sequence pattern — publish it through /api/media/sequence/init`,
    'SEQUENCE_NOT_SUPPORTED_HERE',
  );
}

export interface StartPublishInput {
  /** Target path, down to the task or the asset (`PROJ/SQ010/SH0100/anim`). */
  path: string;
  filename: string;
  contentType?: string;
  kind?: MediaKind;
  size?: number;
  contentHash?: string;
  /** Imposed version name. Absent: the next one is computed (V01, V02…). */
  versionName?: string;
  /** Reuse the version if it already exists, instead of failing. */
  reuseVersion?: boolean;
  /** Create the missing links of the path (sequence, shot, task). */
  createMissing?: boolean;
  /** Framing of the shot, set at creation only. */
  shot?: { name?: string; startFrame?: number; endFrame?: number };
  /**
   * USD scene: variants and purpose to convert. Reserved to `MODEL_3D`.
   * Without it, the conversion goes out on default values and a recomposition is then needed.
   */
  usd?: UsdRequest;
}

/** Guesses a reasonable MIME type when the client does not supply one. */
const CONTENT_TYPE_FALLBACK: Record<MediaKind, string> = {
  [MediaKind.VIDEO]: 'video/mp4',
  [MediaKind.IMAGE]: 'image/png',
  [MediaKind.MODEL_3D]: 'application/octet-stream',
  [MediaKind.SPLAT]: 'application/octet-stream',
};

/**
 * Opens a publication: hierarchy, version, and upload URL. `projectId` is resolved here and returned so that
 * the route validates access BEFORE any write — it is the caller who keeps control of the access check.
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
  // A `kind` imposed by the client does not exempt from the check: this is precisely the case where the
  // extension and the announced type may diverge.
  assertExtensionSupported(kind, input.filename);
  if (input.usd && kind !== MediaKind.MODEL_3D) {
    // Explicit refusal rather than silent omission: a client who believes it is driving the conversion of a
    // .mov must learn it right away, not by re-reading the metadata.
    throw badRequest("« usd » ne s'applique qu'aux médias 3D", 'USD_NOT_3D');
  }

  // Target: the task if the path names one, otherwise the asset itself.
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
    // The selection is not filtered here: at publication, the scene's variantSets are not yet known (the USD
    // analysis has not taken place). This is not a hole — `ModelConvertService.convertUsd` passes it to
    // `sanitizeVariantSelection` against the variantSets actually read, so an invented value never reaches
    // the pipeline.
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
    // The upload is done by direct PUT on this URL, with this content type.
    uploadMethod: 'PUT' as const,
    contentType: input.contentType ?? CONTENT_TYPE_FALLBACK[kind],
    namingWarning: upload.namingWarning,
  };
}

/** Resolves an existing target without creating anything (strict mode). */
async function resolveExistingTarget(projectId: number, path: string) {
  const resolved = await Resolve.resolvePath(path);
  if (resolved.projectId !== projectId) throw notFound('Path lies outside the resolved project');
  return {
    taskId: resolved.task?.id,
    assetId: resolved.task ? undefined : resolved.asset?.id,
  };
}

export interface CompletePublishInput {
  /** Publish the media and the version right away (default: yes). */
  publish?: boolean;
  /** Move the version to REVIEW — submit it without publishing it. */
  submitForReview?: boolean;
  /**
   * Who to entrust the review of this version to, and what each must look at.
   *
   * The DCC's gesture is the same as the screen's: one delivers BY SAYING for whom it is intended. Written
   * before publication, which gives meaning to the project setting "mandatory brief" — a missing brief
   * refuses publication instead of letting a delivery go out that nobody knows how to look at.
   */
  reviewers?: ReviewerInput[];
  /**
   * Upload brief — what the author says about what they deliver.
   *
   * The project may require it (`settings.reviewRequest.requireNote`): finalization is then refused without
   * it, before any write. It bears on the DELIVERY, whereas the briefs
   * of `reviewers` each bear on a person; a DCC that entrusts the review to no one must still be able to
   * satisfy the studio's rule.
   */
  note?: string | null;
}

/**
 * Closes a publication: validates the deposited file, triggers processing, publishes.
 *
 * The publication of the *version* is only attempted if the actor is entitled to it (supervisor+): an artist
 * publishes their media — which is the expected gesture — without the call
 * failing on the grounds that they cannot validate their own version.
 */
export async function complete(actor: Actor, mediaId: number, input: CompletePublishInput = {}) {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaId },
    select: { id: true, versionId: true, uploaderId: true },
  });
  if (!media) throw notFound('Media not found');

  const finalized = await MediaService.finalize(actor, mediaId, input.note);
  const shouldPublish = input.publish !== false;
  if (shouldPublish) await MediaService.publish(actor, mediaId, input.reviewers);
  // Unpublished delivery (`publish: false`): the review is nonetheless entrusted. Losing the brief because
  // the artist keeps their draft one night longer would force them to rewrite it the next day.
  else if (input.reviewers !== undefined) {
    const projectId = await resolveProjectIdForVersion(media.versionId);
    if (projectId) await setReviewers(actor, projectId, media.versionId, input.reviewers);
  }

  const isManager = actor.role === Role.ADMIN || actor.role === Role.SUPERVISOR;
  const nextStatus = shouldPublish && isManager ? VersionStatus.PUBLISHED : VersionStatus.REVIEW;
  if (shouldPublish || input.submitForReview) {
    const projectId = await resolveProjectIdForVersion(media.versionId);
    if (projectId) {
      await VersionService.update(actor, projectId, media.versionId, { status: nextStatus }).catch(
        () => undefined, // publication lock or rights: the media stays published, the version does not
      );
    }
  }

  // 48: a ReView publication creates its Version on the ShotGrid side (link or file depending on the project
  // setting). Queued — the artist does not wait for the remote site.
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
