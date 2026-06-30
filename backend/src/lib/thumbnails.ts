import { prisma } from './prisma';
import { storage } from '../services/StorageService';

/**
 * Résolution des miniatures « effectives » pour les cartes (projets, assets, shots).
 * Règle : miniature explicite (thumbnailKey) si définie, sinon celle du premier média
 * publié rattaché. Renvoie une URL présignée prête à l'affichage (ou null).
 */

const firstMediaThumbKey = async (versionFilter: object): Promise<string | null> => {
  const media = await prisma.mediaObject.findFirst({
    where: { published: true, deletedAt: null, thumbnailKey: { not: null }, version: versionFilter },
    orderBy: { createdAt: 'asc' },
    select: { thumbnailKey: true },
  });
  return media?.thumbnailKey ?? null;
};

export const firstMediaThumbKeyForProject = (projectId: number) =>
  firstMediaThumbKey({
    OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
  });

export const firstMediaThumbKeyForAsset = (assetId: number) =>
  firstMediaThumbKey({ OR: [{ assetId }, { task: { assetId } }] });

export const firstMediaThumbKeyForShot = (shotId: number) =>
  firstMediaThumbKey({ task: { shotId } });

/** URL présignée de la miniature effective (explicite ou fallback premier média). */
export async function effectiveThumbnailUrl(
  explicitKey: string | null,
  fallbackKey: string | null,
): Promise<string | null> {
  const key = explicitKey ?? fallbackKey;
  return key ? storage.getPresignedGetUrl(key) : null;
}
