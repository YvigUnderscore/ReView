// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR } from '../config';
import { fetchKhronosModel } from '../build/models';
import { buildSplat } from '../build/splat';
import { buildUsdAsset, buildUsdShot, zipUsdAsset, type UsdAssetResult } from '../build/usd';
import { makeClip, makeFrames, makeStill } from '../build/video';
import { ensureDir, exists } from '../lib/download';
import { makeRng } from '../lib/rng';
import type { AssetSpec, FilmKey, MediaSpec, ProjectSpec, ShotSpec } from '../data/types';

/**
 * Production du fichier réel derrière chaque livrable planifié.
 *
 * Un plan de version dit « ici, un playblast d'animation de six secondes » ; ce module va le
 * chercher dans le master du film, le traite pour qu'il ressemble à un playblast, et rend un
 * chemin. Même chose pour les scènes USD, les splats et les séquences d'images. Tout est mis
 * en cache : relancer la génération ne refait ni un téléchargement ni un encodage.
 */

/**
 * Graphes USD en cours ou déjà construits, par clé d'asset.
 *
 * On mémorise la **promesse**, pas le résultat : le même asset est demandé par plusieurs
 * tâches à la fois (modeling, look dev, et chaque plan qui le référence), et deux
 * constructions simultanées écrivent dans le même dossier — Blender échoue alors sur un
 * fichier verrouillé, une fois sur deux et jamais au même endroit.
 */
const usdAssets = new Map<string, Promise<UsdAssetResult>>();

/** Film dont provient un plan : le sien, celui de son épisode, sinon celui du projet. */
export function filmOf(spec: ProjectSpec, shot: ShotSpec | undefined, episodeCode?: string): FilmKey {
  if (shot?.film) return shot.film;
  const episode = spec.episodes?.find((e) => e.code === episodeCode);
  return episode?.film ?? spec.film;
}

/** Construit (une seule fois) le graphe USD d'un asset déclaré `usd`. */
export async function ensureUsdAsset(asset: AssetSpec): Promise<UsdAssetResult | null> {
  if (!asset.usd) return null;
  const pending = usdAssets.get(asset.key);
  if (pending) return pending;
  const built = buildUsdAsset({
    name: asset.name.replace(/\s+/g, ''),
    polyHavenSlug: asset.usd.polyHavenSlug,
    scale: asset.usd.scale,
    weatheredTint: asset.usd.weatheredTint,
    version: 'v003',
  });
  usdAssets.set(asset.key, built);
  return built;
}

/** Scène USD d'un plan : les assets du plan, placés, animés, éclairés. */
async function buildShotScene(
  spec: ProjectSpec,
  shot: ShotSpec,
  filename: string,
  assets: AssetSpec[],
): Promise<string> {
  const target = join(OUT_DIR, 'usd', filename);
  if (await exists(target)) return target;

  const usable: UsdAssetResult[] = [];
  for (const key of shot.assets ?? []) {
    const asset = assets.find((a) => a.key === key);
    if (!asset?.usd) continue;
    const built = await ensureUsdAsset(asset);
    if (built) usable.push(built);
  }
  if (usable.length === 0) {
    const fallback = assets.find((a) => a.usd);
    if (!fallback) throw new Error(`${shot.code}: no USD asset available for the shot scene`);
    const built = await ensureUsdAsset(fallback);
    if (built) usable.push(built);
  }

  const rng = makeRng(`${spec.slug}:scene:${shot.code}`);
  const frames = Math.round((shot.duration ?? 5) * spec.framerate);
  const map = new Map(usable.map((asset) => [asset.name, asset]));
  const end = spec.startFrame + frames - 1;

  const placements = usable.flatMap((asset, index) => {
    const copies = index === 0 ? 2 : 1;
    return Array.from({ length: copies }, (_, copy) => {
      const x = (index - usable.length / 2) * 1.3 + copy * 0.9;
      const z = -0.4 - copy * 0.7;
      return {
        asset: asset.name,
        prim: `${asset.name.toLowerCase()}_${String.fromCharCode(97 + copy)}`,
        group: 'props' as const,
        translate: [Number(x.toFixed(2)), 0, Number(z.toFixed(2))] as [number, number, number],
        rotate: [0, rng.int(-60, 60), 0] as [number, number, number],
        scale: Number((0.85 + rng.next() * 0.3).toFixed(2)),
        ...(copy === 0
          ? {
              anim: {
                rotate: {
                  [String(spec.startFrame)]: [0, 0, 0],
                  [String(end)]: [0, rng.int(-25, 25), rng.int(-4, 4)],
                },
              },
            }
          : {}),
      };
    });
  });

  const result = await buildUsdShot(
    {
      shot: shot.code,
      start: spec.startFrame,
      end,
      fps: spec.framerate,
      assets: placements,
      camera: {
        focal: rng.pick([28, 35, 40, 50, 75]),
        aspect: spec.resolution.width / spec.resolution.height,
        translate: [0, 0.7, 3.2],
        rotate: [-8, 0, 0],
        anim: {
          translate: {
            [String(spec.startFrame)]: [0, 0.7, 3.2],
            [String(end)]: [Number((rng.next() * 0.8 - 0.4).toFixed(2)), 0.6, 2.4],
          },
        },
      },
      lights: [
        { name: 'key', type: 'DistantLight', intensity: 3.1, color: [1, 0.95, 0.88], rotate: [-40, 28, 0] },
        { name: 'sky', type: 'DomeLight', intensity: 0.85, color: [0.6, 0.7, 0.95] },
      ],
      fx: rng.chance(0.4)
        ? [
            {
              name: 'dustVolume',
              radius: 1.3,
              translate: [0, 0.9, 0],
              color: [0.72, 0.68, 0.6],
              opacity: 0.16,
            },
          ]
        : [],
    },
    map,
    join('usd', filename),
  );
  return result.archive;
}

export interface FileRequest {
  spec: ProjectSpec;
  media: MediaSpec;
  filename: string;
  /** Plan porteur (absent pour un asset). */
  shot?: ShotSpec;
  episodeCode?: string;
  asset?: AssetSpec;
  /** Tous les assets du projet (pour composer une scène de plan). */
  assets: AssetSpec[];
  /** Sous-dossier de sortie, en général le code du plan. */
  folder: string;
}

/** Chemin du fichier livrable, produit si nécessaire. Renvoie aussi les frames d'une séquence. */
export async function produceFile(request: FileRequest): Promise<{ path: string; frames?: string[] }> {
  const { spec, media, filename, shot, asset, folder } = request;
  const film = filmOf(spec, shot, request.episodeCode);
  const out = join(folder, filename);

  switch (media.type) {
    case 'clip': {
      const label = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' / ');
      return {
        path: await makeClip({
          film: media.film ?? film,
          start: media.at,
          duration: media.duration ?? 5,
          out,
          look: media.look,
          label,
          startFrame: spec.startFrame,
          width: media.width ?? 1280,
        }),
      };
    }
    case 'still':
      return {
        path: await makeStill({
          film: media.film ?? film,
          at: media.at,
          out,
          ...(media.look ? { look: media.look } : {}),
          width: 1920,
          ...(media.extra ? { extraFilters: media.extra } : {}),
        }),
      };
    case 'frames': {
      const frames = await makeFrames({
        film,
        start: media.at,
        count: media.count,
        dir: join(folder, filename.replace('.%04d.png', '')),
        pattern: filename,
        startFrame: spec.startFrame,
        look: media.look,
        width: 1280,
      });
      return { path: frames[0]!, frames };
    }
    case 'usdAsset': {
      const target = asset ?? request.assets.find((a) => a.key === media.asset);
      if (!target?.usd) throw new Error(`${media.asset}: asset has no USD graph`);
      const built = await ensureUsdAsset(target);
      if (!built) throw new Error(`${media.asset}: USD graph could not be built`);
      return { path: await zipUsdAsset(built, join(folder, filename)) };
    }
    case 'usdShot': {
      if (!shot) throw new Error('usdShot media outside a shot');
      return { path: await buildShotScene(spec, shot, filename, request.assets) };
    }
    case 'glb': {
      const source = await fetchKhronosModel('Fox', 'Fox.glb');
      const target = join(OUT_DIR, out);
      await ensureDir(join(target, '..'));
      if (!(await exists(target))) await copyFile(source, target);
      return { path: target };
    }
    case 'splat':
    default: {
      const splat = media;
      const built = await buildSplat({
        polyHavenSlug: splat.scan,
        out,
        count: splat.count ?? 180000,
      });
      return { path: built.path };
    }
  }
}
