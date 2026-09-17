// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaObject } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { mediaViewKey } from './MediaService';
import { findWithUrl } from './HdriService';
import { resolveProjectSettingsById } from '../lib/projectSettings';

/**
 * Ce qu'un invité reçoit pour ouvrir UN média du lien — extrait de `client.routes.ts`, où
 * il ne restait plus de place, et complété.
 *
 * La page publique déclarait depuis le début quatorze champs et la route n'en servait que
 * trois : le viewer invité retombait donc sur des valeurs par défaut aveugles. Deux d'entre
 * elles se voient tout de suite dès qu'on laisse le client annoter :
 *
 *  - **`fps`** : une annotation vidéo est ancrée à une frame. Sans la cadence réelle, le
 *    repli 24 fps décale d'une frame par seconde sur un média en 23.976 — le client cite
 *    alors un numéro que l'artiste ne retrouve pas.
 *  - **`startFrame`** : c'est la numérotation du studio. Répondre 1001 partout revient à
 *    parler d'une autre bobine.
 *
 * Le reste (mise en scène splat, override USD, éclairage, HDRI) est ce qui fait qu'un
 * spatial s'ouvre chez le client **tel que le studio l'a mis en scène**, et non brut.
 *
 * Tout se lit dans `media.metadata`, déjà chargé par `findShareMedia` — la portée du lien a
 * donc déjà tranché l'accès. Aucun champ n'ouvre un fichier qui n'appartienne pas à ce
 * média : chaque URL est présignée en lecture seule, comme les autres.
 */

/** Métadonnées lues ici — miroir partiel de ce qu'écrit le worker. */
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
 * HDRI de la présentation, déjà résolue en URL pour l'invité. Le viewer connecté interroge
 * `/api/studio/hdris`, une route authentifiée : sans cette résolution côté serveur, un splat
 * mis en scène sous une HDRI s'ouvre chez le client dans un éclairage neutre.
 */
async function resolveHdri(meta: ClientMediaMeta): Promise<{ url: string; format: string } | null> {
  const hdriId = str(meta.splatPresentation?.lighting?.hdriId);
  if (!hdriId) return null;
  const entry = await findWithUrl(hdriId);
  return entry ? { url: entry.url, format: entry.format } : null;
}

export async function buildClientMediaSource(media: MediaObject, projectId: number) {
  const meta = (media.metadata ?? {}) as ClientMediaMeta;
  // Le dérivé client (vidéo, slate et burn-ins en tête) est prioritaire ; à défaut,
  // `mediaViewKey` et non `mediaSourceKey` — le client reçoit ce qu'un navigateur sait
  // afficher. Un EXR, un DPX ou un TIFF partagés arrivaient sinon en format d'origine,
  // c'est-à-dire en image cassée, alors que le proxy web existe déjà.
  const clientKey = str(meta.clientProxyKey);
  const [url, glbUrl, splatMaskUrl, splatSubsetUrl, project, projectSettings, hdri] = await Promise.all([
    storage.getPresignedGetUrl(clientKey ?? mediaViewKey(media)),
    // Le dérivé GLB appartient au même média, donc à la même portée : un .fbx, un .obj ou
    // un .usd n'est lisible par aucun navigateur.
    str(meta.glbKey) ? storage.getPresignedGetUrl(meta.glbKey as string) : Promise.resolve(null),
    str(meta.splatMaskKey) ? storage.getPresignedGetUrl(meta.splatMaskKey as string) : Promise.resolve(null),
    str(meta.splatSubsetKey)
      ? storage.getPresignedGetUrl(meta.splatSubsetKey as string)
      : Promise.resolve(null),
    prisma.project.findUnique({ where: { id: projectId }, select: { startFrame: true } }),
    resolveProjectSettingsById(projectId),
    resolveHdri(meta),
  ]);

  const usd = meta.model?.usd ?? null;
  return {
    url,
    // Le slate n'existe que dans le dérivé client : le front décale ses timestamps d'autant,
    // pour que l'invité et l'artiste parlent de la même image.
    slateSec: clientKey && typeof meta.slateSec === 'number' ? meta.slateSec : 0,
    glbUrl,
    fps: typeof meta.fps === 'number' ? meta.fps : null,
    startFrame: project?.startFrame ?? 1001,
    usdOverride: meta.usdOverride ?? null,
    // Clé d'indexation de l'override : sans elle, la scène s'affiche telle que le GLB a été
    // cuit — un repli correct, pas la mise en scène du superviseur.
    usdPrimPaths: usd?.prims?.map((prim) => prim.path) ?? null,
    usdVariantSets: usd?.variantSets ?? null,
    splatEdits: meta.splatEdits ?? null,
    splatMaskUrl,
    splatSubsetUrl,
    splatPresentation: meta.splatPresentation ?? null,
    projectDefaultLighting: projectSettings.defaultLighting ?? null,
    hdri,
  };
}
