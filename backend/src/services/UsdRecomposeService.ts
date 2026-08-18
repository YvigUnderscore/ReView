// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertNotPublished } from '../lib/publishLock';
import { sanitizeVariantSelection, type UsdVariantSet } from '../lib/usdInspect';
import { type UsdPurpose } from '../lib/blenderUsd';
import { assertMediaManage } from './MediaService';
import { enqueueMediaJob } from './JobService';
import { logAudit } from './AuditService';
import type { UsdModelInfo, UsdRequest } from './ModelConvertService';

/**
 * Recomposition d'une scène USD (Phase 45, 45.E) : rejouer la conversion avec une autre
 * **sélection de variantes** ou un autre **purpose** (render/proxy/guide).
 *
 * Le fichier source n'est jamais modifié : la sélection est appliquée par une couche d'overlay
 * USD au moment de la conversion (cf. `workers/usd/analyze_usd.py`). Elle est mémorisée dans
 * `metadata.usdRequest` plutôt que dans les données du job BullMQ, pour survivre aux retries
 * comme aux `reprocess` ultérieurs.
 *
 * Verrou de publication (Phase 11) : recomposer change le contenu rendu, donc c'est refusé sur
 * un média publié — on corrige en publiant une nouvelle version.
 */

type SessionUser = { id: number; role: Role };

export interface RecomposeInput {
  /** `{ "/World/Asset": { "modelingVariant": "hero" } }` */
  variants: Record<string, Record<string, string>>;
  purpose: UsdPurpose;
}

/** Description USD posée par le worker à la conversion précédente, ou null. */
function readUsdInfo(metadata: unknown): UsdModelInfo | null {
  const model = (metadata as { model?: { usd?: UsdModelInfo } } | null)?.model;
  return model?.usd ?? null;
}

/**
 * Enfile une nouvelle conversion du média avec la sélection demandée. La sélection est
 * **filtrée contre les variantSets réellement présents** dans la scène : une valeur inventée
 * par le client n'atteint jamais le pipeline.
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
  assertNotPublished(media);

  const usd = readUsdInfo(media.metadata);
  if (!usd)
    throw badRequest(
      "Ce média n'est pas une scène USD analysée (outillage USD absent à la conversion ?)",
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
