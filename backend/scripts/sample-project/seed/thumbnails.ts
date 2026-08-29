// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrismaClient } from '@prisma/client';
import { storage } from '../../../src/services/StorageService';
import { makeStill } from '../build/video';
import { filmOf } from './media-files';
import type { SeededProject } from './project';

/**
 * Vignettes d'entité : séquences, plans, assets et projets.
 *
 * Une grille de cartes grises ne montre rien. Chaque vignette est une image réellement tirée
 * du plan qu'elle représente — au milieu du plan, pas à sa première image, qui est souvent
 * un fondu. Elles sont déposées directement dans le stockage objet : ce sont des images
 * d'habillage, elles n'ont rien à faire dans la file de traitement des médias.
 */

/**
 * Clé d'une vignette d'entité — même forme que `StorageService.entityThumbnailKey`, que la
 * classe ne rend pas accessible hors du service. Le préfixe est réservé : c'est lui que le
 * service vérifie avant d'accepter une clé, et il ne dépend que de l'entité.
 */
const entityThumbnailKey = (holder: 'sequence' | 'shot' | 'asset', id: number, ext: string): string =>
  `entity-thumbs/${holder}/${id}${ext}`;

export interface ThumbnailResult {
  sequences: number;
  shots: number;
  assets: number;
}

export async function seedThumbnails(prisma: PrismaClient, seeded: SeededProject): Promise<ThumbnailResult> {
  const result: ThumbnailResult = { sequences: 0, shots: 0, assets: 0 };
  const spec = seeded.spec;

  // Épisode : sans vignette propre, il hérite du premier média publié de ses plans — donc
  // d'un playblast de layout en noir et blanc, burn-in compris. La carte d'un épisode doit
  // montrer l'épisode, pas son étape la plus ancienne.
  for (const episode of spec.episodes ?? []) {
    const sequence = spec.sequences.find((s) => s.episode === episode.code);
    const shot = sequence?.shots[0];
    if (!shot) continue;
    const record = await prisma.episode.findFirst({
      where: { projectId: seeded.project.id, code: episode.code },
    });
    if (!record) continue;
    const still = await makeStill({
      film: episode.film,
      at: shot.at + (shot.duration ?? 4) / 2,
      out: `thumbs/${spec.slug}/ep-${episode.code}.jpg`,
      width: 960,
    });
    const key = `entity-thumbs/episode/${record.id}.jpg`;
    await storage.uploadFile(key, still, 'image/jpeg');
    await prisma.episode.update({ where: { id: record.id }, data: { thumbnailKey: key } });
  }

  for (const sequence of spec.sequences) {
    const record = seeded.sequences.get(sequence.code);
    const first = sequence.shots[0];
    if (!record || !first) continue;
    const still = await makeStill({
      film: filmOf(spec, first, sequence.episode),
      at: first.at + 1,
      out: `thumbs/${spec.slug}/seq-${sequence.code}.jpg`,
      width: 960,
    });
    const key = entityThumbnailKey('sequence', record.id, '.jpg');
    await storage.uploadFile(key, still, 'image/jpeg');
    await prisma.sequence.update({ where: { id: record.id }, data: { thumbnailKey: key } });
    result.sequences += 1;

    for (const shot of sequence.shots) {
      const shotRecord = seeded.shots.get(shot.code);
      if (!shotRecord) continue;
      const middle = shot.at + (shot.duration ?? 5) / 2;
      const image = await makeStill({
        film: filmOf(spec, shot, sequence.episode),
        at: middle,
        out: `thumbs/${spec.slug}/shot-${shot.code}.jpg`,
        width: 960,
      });
      const shotKey = entityThumbnailKey('shot', shotRecord.id, '.jpg');
      await storage.uploadFile(shotKey, image, 'image/jpeg');
      await prisma.shot.update({ where: { id: shotRecord.id }, data: { thumbnailKey: shotKey } });
      result.shots += 1;
    }
  }

  for (const asset of spec.assets) {
    const record = seeded.assets.get(asset.key);
    if (!record) continue;
    const source = asset.still ?? { at: 90 };
    const image = await makeStill({
      film: source.film ?? spec.film,
      at: source.at,
      out: `thumbs/${spec.slug}/asset-${asset.key}.jpg`,
      width: 960,
      look: 'lookdev',
    });
    const key = entityThumbnailKey('asset', record.id, '.jpg');
    await storage.uploadFile(key, image, 'image/jpeg');
    await prisma.asset.update({ where: { id: record.id }, data: { thumbnailKey: key } });
    result.assets += 1;
  }

  // Vignette du projet : l'image la plus parlante du film, pas le premier plan venu.
  const hero = spec.sequences[0]?.shots[1] ?? spec.sequences[0]?.shots[0];
  if (hero) {
    const image = await makeStill({
      film: filmOf(spec, hero, spec.sequences[0]?.episode),
      at: hero.at + 1.5,
      out: `thumbs/${spec.slug}/project.jpg`,
      width: 1280,
    });
    const key = `entity-thumbs/project/${seeded.project.id}.jpg`;
    await storage.uploadFile(key, image, 'image/jpeg');
    await prisma.project.update({ where: { id: seeded.project.id }, data: { thumbnailKey: key } });
  }

  return result;
}
