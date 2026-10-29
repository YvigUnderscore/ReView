// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaObject } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { mediaViewKey } from './MediaService';
import { findWithUrl } from './HdriService';
import { resolveProjectSettingsById } from '../lib/projectSettings';
import { resolveDeliveryAspect } from '../lib/deliveryAspect';

/**
 * What a guest receives to open ONE media of the link: extracted from `client.routes.ts`, where there was no
 * room left, and completed.
 *
 * The public page had declared fourteen fields from the start, and the route only served three: the guest
 * viewer therefore fell back to blind default values. Two of them show up immediately as soon as the client
 * is allowed to annotate:
 *
 * - **`fps`**: a video annotation is anchored to a frame. Without the real frame rate, the 24 fps fallback
 * drifts by one frame
 *    per second on a 23.976 media, and the client then cites a number the artist cannot find.
 * - **`startFrame`**: this is the studio's numbering. Answering 1001 everywhere amounts to talking about
 * another reel.
 *
 * The rest (splat staging, USD override, lighting, HDRI) is what makes a spatial media open for the client
 * **as the studio staged it**, and not raw.
 *
 * Everything is read from `media.metadata`, already loaded by `findShareMedia`: the scope of the link has
 * therefore already settled access. No field opens a file that does not belong to this media: each URL is
 * presigned read-only, like the others.
 */

/** Metadata read here: a partial mirror of what the worker writes. */
interface ClientMediaMeta {
  clientProxyKey?: string;
  slateSec?: number;
  glbKey?: string;
  fps?: number;
  usdOverride?: unknown;
  splatEdits?: unknown;
  splatMaskKey?: string;
  splatSubsetKey?: string;
  splatPresentation?: { camera?: { aspect?: number }; lighting?: { hdriId?: string } } | null;
  model?: { usd?: { prims?: { path: string }[]; variantSets?: unknown[] } } | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/**
 * Presentation HDRI, already resolved to a URL for the guest. The connected viewer queries
 * `/api/studio/hdris`, an authenticated route: without this resolution server-side, a splat staged under an
 * HDRI opens for the client with neutral lighting.
 */
async function resolveHdri(meta: ClientMediaMeta): Promise<{ url: string; format: string } | null> {
  const hdriId = str(meta.splatPresentation?.lighting?.hdriId);
  if (!hdriId) return null;
  const entry = await findWithUrl(hdriId);
  return entry ? { url: entry.url, format: entry.format } : null;
}

export async function buildClientMediaSource(media: MediaObject, projectId: number) {
  const meta = (media.metadata ?? {}) as ClientMediaMeta;
  // The client derivative (video, slate and burn-ins first) takes priority; otherwise `mediaViewKey` and not
  // `mediaSourceKey`: the client receives what a browser can display. Otherwise a shared EXR, DPX or TIFF
  // would arrive in its original format, i.e. as a broken image, although the web proxy already exists.
  const clientKey = str(meta.clientProxyKey);
  const [url, glbUrl, splatMaskUrl, splatSubsetUrl, project, projectSettings, deliveryAspect, hdri] =
    await Promise.all([
      storage.getPresignedGetUrl(clientKey ?? mediaViewKey(media)),
      // The GLB derivative belongs to the same media, hence to the same scope: a .fbx, .obj or .usd is
      // readable by no browser.
      str(meta.glbKey) ? storage.getPresignedGetUrl(meta.glbKey as string) : Promise.resolve(null),
      str(meta.splatMaskKey)
        ? storage.getPresignedGetUrl(meta.splatMaskKey as string)
        : Promise.resolve(null),
      str(meta.splatSubsetKey)
        ? storage.getPresignedGetUrl(meta.splatSubsetKey as string)
        : Promise.resolve(null),
      prisma.project.findUnique({ where: { id: projectId }, select: { startFrame: true } }),
      resolveProjectSettingsById(projectId),
      // Delivery frame ratio (pipeline setting inherited studio -> project -> sequence -> shot):
      // without it, the guest opens an unstaged spatial in an arbitrary 16:9 frame.
      resolveDeliveryAspect(media.versionId, projectId),
      resolveHdri(meta),
    ]);

  const usd = meta.model?.usd ?? null;
  return {
    url,
    // The slate only exists in the client derivative: the front end shifts its timestamps accordingly, so
    // that the guest and the artist talk about the same image.
    slateSec: clientKey && typeof meta.slateSec === 'number' ? meta.slateSec : 0,
    glbUrl,
    fps: typeof meta.fps === 'number' ? meta.fps : null,
    startFrame: project?.startFrame ?? 1001,
    usdOverride: meta.usdOverride ?? null,
    // Override indexing key: without it, the scene displays as the GLB was baked: a correct fallback, not the
    // supervisor's staging.
    usdPrimPaths: usd?.prims?.map((prim) => prim.path) ?? null,
    usdVariantSets: usd?.variantSets ?? null,
    splatEdits: meta.splatEdits ?? null,
    splatMaskUrl,
    splatSubsetUrl,
    splatPresentation: meta.splatPresentation ?? null,
    // Review frame ratio: a DEFAULT value, which the aspect frozen in the presentation (when there is one)
    // keeps overriding, exactly as in the internal review.
    deliveryAspect,
    projectDefaultLighting: projectSettings.defaultLighting ?? null,
    hdri,
  };
}
