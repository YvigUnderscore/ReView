import { MediaKind, MediaStatus, Prisma, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertNotPublished } from '../lib/publishLock';
import { isEmptySceneOverride, type SceneOverride } from '../lib/sceneOverride';
import { assertMediaManage } from './MediaService';
import { logAudit } from './AuditService';

/**
 * Override de base d'une scène 3D (Phase 46, 46.D) — `metadata.usdOverride`.
 *
 * Réglé pendant le prépublish par un gestionnaire, il est **figé à la publication** puis
 * rejoué à l'ouverture pour tous les spectateurs : c'est la mise en scène de référence de
 * l'asset. Après publication, personne ne le modifie plus — les reviewers proposent leurs
 * changements dans un commentaire (partie d'annotation `scene-override`), ce qui garde la
 * scène commune stable tout en laissant chacun explorer librement de son côté.
 *
 * Aucun job worker : l'override est un delta appliqué au chargement, pas une reconversion.
 */

type SessionUser = { id: number; role: Role };

/** Gestionnaire + média 3D non publié : mêmes règles que les éditions splat (verrou Phase 11). */
async function assertEditableScene(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { id: true, kind: true, published: true, status: true, metadata: true },
  });
  if (!media) throw notFound('Média introuvable');
  if (media.kind !== MediaKind.MODEL_3D) throw badRequest('Override réservé aux médias 3D', 'NOT_3D');
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload non finalisé', 'NOT_FINALIZED');
  assertNotPublished(media);
  return media;
}

/** Enregistre (ou efface) l'override de base. Un override vide est stocké comme absent. */
export async function setSceneOverride(user: SessionUser, id: number, override: SceneOverride | null) {
  const media = await assertEditableScene(user, id);
  const value = override && !isEmptySceneOverride(override) ? override : null;

  const metadata = {
    ...((media.metadata ?? {}) as object),
    usdOverride: value as unknown as Prisma.InputJsonValue,
  } as Prisma.InputJsonObject;
  await prisma.mediaObject.update({ where: { id }, data: { metadata } });

  logAudit({
    userId: user.id,
    action: 'MEDIA_USD_OVERRIDE',
    entityType: 'MediaObject',
    entityId: id,
    metadata: { prims: value ? Object.keys(value.prims).length : 0, cleared: value === null },
  });
  return { usdOverride: value };
}
