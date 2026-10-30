// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertWritable } from '../lib/publishLock';
import { sanitizeVariantSelection, type UsdVariantSet } from '../lib/usdInspect';
import { type UsdPurpose } from '../lib/blenderUsd';
import { assertMediaManage } from './MediaService';
import { enqueueMediaJob } from '../lib/queues';
import { logAudit } from './AuditService';
import type { UsdModelInfo, UsdRequest } from './ModelConvertService';

/**
 * Recomposition of a USD scene (Phase 45, 45.E): replays the conversion with another **variant selection** or another **purpose** (render/proxy/guide).
 *
 * The source file is never modified: the selection is applied by a USD overlay layer at conversion time (see `workers/usd/analyze_usd.py`). It is recorded in
 * `metadata.usdRequest` rather than in the BullMQ job data, to survive retries as well as later `reprocess` runs.
 *
 * Publication lock (Phase 11): recomposing changes the rendered content, so it is refused on a published media — one corrects it by publishing a new version.
 */

type SessionUser = { id: number; role: Role };

export interface RecomposeInput {
  /** `{ "/World/Asset": { "modelingVariant": "hero" } }` */
  variants: Record<string, Record<string, string>>;
  purpose: UsdPurpose;
}

/** USD description recorded by the worker at the previous conversion, or null. */
function readUsdInfo(metadata: unknown): UsdModelInfo | null {
  const model = (metadata as { model?: { usd?: UsdModelInfo } } | null)?.model;
  return model?.usd ?? null;
}

/**
 * Queues a new conversion of the media with the requested selection. The selection is **filtered against the variantSets actually present** in the scene: a value
 * invented by the client never reaches the pipeline.
 */
export async function recomposeUsd(user: SessionUser, id: number, input: RecomposeInput) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { id: true, kind: true, published: true, status: true, metadata: true },
  });
  if (!media) throw notFound('Media not found');
  if (media.kind !== MediaKind.MODEL_3D) throw badRequest('Recomposing is for 3D media only', 'NOT_3D');
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload not finalised', 'NOT_FINALIZED');
  // Recomposing does not replace the delivered file: it derives a readable representation from it. Writing therefore remains allowed after publication (table in `lib/publishLock`).
  assertWritable(media, 'usdRecompose');

  const usd = readUsdInfo(media.metadata);
  if (!usd)
    throw badRequest(
      'This media is not an analyzed USD scene (USD tooling missing at conversion?)',
      'NOT_USD',
    );

  const known: UsdVariantSet[] = usd.variantSets ?? [];
  const request: UsdRequest = {
    variants: sanitizeVariantSelection(input.variants, known),
    purpose: input.purpose,
  };

  const metadata = {
    ...((media.metadata ?? {}) as object),
    usdRequest: request as unknown as Prisma.InputJsonValue,
  } as Prisma.InputJsonObject;

  await prisma.mediaObject.update({
    where: { id },
    data: { status: MediaStatus.PROCESSING, metadata },
  });
  await enqueueMediaJob({ mediaObjectId: id, kind: 'convert3d' });
  logAudit({
    userId: user.id,
    action: 'MEDIA_USD_RECOMPOSE',
    entityType: 'MediaObject',
    entityId: id,
    metadata: { purpose: request.purpose, variants: request.variants },
  });

  return { id, status: MediaStatus.PROCESSING, selection: request, requeued: true };
}
