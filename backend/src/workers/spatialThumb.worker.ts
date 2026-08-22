// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';
import { Worker } from 'bullmq';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';

import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type SpatialThumbJobData } from '../services/JobService';
import { prisma } from '../lib/prisma';
import { storage, StorageService } from '../services/StorageService';
import { logger } from '../lib/logger';
import { getExtension } from '../lib/fileSignatures';
import { spatialThumbSource } from '../lib/mediaJobKind';
import { readSplatCloud } from '../lib/splatPoints';
import { renderPointCloudPng } from '../lib/pointThumbnail';
import { renderModelThumbnail } from '../services/ModelConvertService';
import { registerWorkerShutdown } from './shutdown';

/**
 * Worker de **vignette spatiale** : produit l'aperçu des médias 3D et gaussian splat.
 *
 * Le manque comblé : `jobKindFor` ne déclenchait rien pour un splat ni pour un `.glb` natif,
 * et la branche `convert3d` du worker FFmpeg n'écrivait aucun `thumbnailKey`. Une page de
 * plan pleine d'assets 3D n'affichait donc que des tuiles vides jusqu'à ce qu'un humain
 * ouvre chaque review pour capturer la vue à la main.
 *
 * Trois invariants tenus par ce worker :
 *  1. **Il ne touche jamais au statut du média.** Aucun média ne peut rester coincé en
 *     `PROCESSING` à cause d'une vignette, et un rendu impossible (Blender absent de
 *     l'image, splat dans un conteneur illisible) est un job *réussi* sans image.
 *  2. **Il n'écrase jamais une vignette existante** — écriture conditionnelle sur
 *     `thumbnailKey IS NULL`, la même garde que la capture client (`setAutoThumbnail`).
 *     Le job est donc idempotent, et rejouable sans risque.
 *  3. **Il est borné en durée** : le rendu Blender a son propre délai maximal
 *     (`BLENDER_THUMB_TIMEOUT_MS`, même motif que `lib/ffmpegTimeout`), et la lecture d'un
 *     splat est un parcours en flux à mémoire constante.
 */

/** Budget de points retenus dans un splat : au-delà, la vignette ne gagne plus rien. */
export const SPLAT_THUMB_MAX_POINTS = 160_000;

export type SpatialThumbOutcome =
  'missing' | 'exists' | 'unsupported' | 'pending' | 'no-render' | 'raced' | 'rendered';

/**
 * Le GLB dérivé n'existe pas encore : la conversion est en vol. Erreur *attendue*, dont la
 * seule fonction est de faire replanifier le job par BullMQ (recul exponentiel).
 */
export class SpatialThumbPendingError extends Error {
  readonly mediaObjectId: number;

  constructor(mediaObjectId: number) {
    super(`spatial thumbnail for media ${mediaObjectId}: the converted GLB is not available yet`);
    this.name = 'SpatialThumbPendingError';
    this.mediaObjectId = mediaObjectId;
  }
}

/** Rend et pose la vignette d'un média spatial. Ne lève que sur incident d'infrastructure. */
export async function renderSpatialThumb(mediaId: number): Promise<SpatialThumbOutcome> {
  const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
  if (!media) return 'missing';
  if (media.thumbnailKey) return 'exists';

  const ext = getExtension(media.originalName);
  const source = spatialThumbSource(media.kind, ext);
  if (!source) return 'unsupported';

  const metadata = (media.metadata ?? {}) as { glbKey?: unknown };
  const dir = await mkdtemp(join(tmpdir(), 'review-thumb-'));
  try {
    const png = join(dir, 'thumb.png');

    if (source === 'model') {
      const glbKey =
        typeof metadata.glbKey === 'string' ? metadata.glbKey : ext === '.glb' ? media.storageKey : null;
      // Pas encore de GLB : soit la conversion tourne (on repassera), soit elle a échoué et
      // il n'y a rien à rendre — dans les deux cas le statut du média n'est pas notre affaire.
      if (!glbKey) return media.status === MediaStatus.PROCESSING ? 'pending' : 'unsupported';
      const glb = join(dir, 'model.glb');
      await storage.downloadToFile(glbKey, glb);
      const result = await renderModelThumbnail(glb, png);
      if (!result.rendered) {
        logger.warn(`[spatialThumb.worker] média ${mediaId} non rendu (${result.reason})`);
        return 'no-render';
      }
    } else {
      const src = join(dir, `src${ext}`);
      await storage.downloadToFile(media.storageKey, src);
      const { size } = await stat(src);
      const read = await readSplatCloud(src, ext, size, SPLAT_THUMB_MAX_POINTS);
      if (!read.ok) {
        logger.warn(`[spatialThumb.worker] splat ${mediaId} illisible (${read.reason})`);
        return 'no-render';
      }
      const buf = renderPointCloudPng(read.cloud);
      if (!buf) {
        logger.warn(`[spatialThumb.worker] splat ${mediaId} : nuage dégénéré, aucune vignette`);
        return 'no-render';
      }
      await writeFile(png, buf);
    }

    const key = StorageService.thumbnailKey(mediaId, 'png');
    await storage.uploadFile(key, png, 'image/png');
    // Écriture conditionnelle : une capture client concurrente peut avoir gagné entre-temps.
    const { count } = await prisma.mediaObject.updateMany({
      where: { id: mediaId, thumbnailKey: null },
      data: { thumbnailKey: key },
    });
    if (count === 0) {
      await storage.deleteObject(key).catch(() => undefined);
      return 'raced';
    }
    return 'rendered';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const spatialThumbWorker = new Worker<SpatialThumbJobData, void, string>(
  QUEUE_NAMES.SPATIAL_THUMB,
  async (job) => {
    const mediaId = job.data.mediaObjectId;
    const outcome = await renderSpatialThumb(mediaId);
    if (outcome === 'pending') throw new SpatialThumbPendingError(mediaId);
    logger.info(`[spatialThumb.worker] media=${mediaId} → ${outcome}`);
  },
  // Concurrence 1 : un rendu Cycles sature les cœurs disponibles, en lancer deux ne ferait
  // que les ralentir tous les deux — et voler du CPU au transcodage, lui bloquant.
  { connection: redisConnectionOptions, autorun: false, concurrency: 1 },
);

spatialThumbWorker.on('failed', (job, err) =>
  err instanceof SpatialThumbPendingError
    ? logger.debug(`[spatialThumb.worker] media=${job?.data.mediaObjectId} en attente du GLB`)
    : logger.warn({ err }, `[spatialThumb.worker] ✗ media=${job?.data.mediaObjectId}`),
);

/** Démarre le worker (appelé depuis le process worker principal). */
export function startSpatialThumbWorker(): void {
  // La boucle du worker vit aussi longtemps que le process : rien à attendre ici.
  void spatialThumbWorker.run();
  registerWorkerShutdown('spatialThumb.worker', spatialThumbWorker);
  logger.info('[spatialThumb.worker] démarré.');
}
