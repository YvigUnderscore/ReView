// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaObject, PrismaClient } from '@prisma/client';
import { SAMPLE_PASSWORD } from '../config';
import {
  login,
  publishMedia,
  uploadMedia,
  uploadSequence,
  waitForProcessing,
  type Session,
} from '../lib/api';
import { memberByKey } from '../data/team';
import type { AssetSpec, ShotSpec } from '../data/types';
import { produceFile } from './media-files';
import type { SeededProject, SeededVersion } from './project';

/**
 * Dépôt des médias par le vrai chemin d'upload.
 *
 * C'est la seule partie qui passe par l'API et non par la base, et c'est délibéré : sans
 * elle, rien n'est transcodé. Chaque fichier est déposé **par son auteur** — un playblast
 * d'animation appartient à l'animateur, pas à l'administrateur — parce que l'uploader décide
 * du quota consommé, de qui voit un brouillon, et de ce qu'affiche la fiche technique.
 */

/** Sessions ouvertes, une par membre (les comptes désactivés repassent par l'administrateur). */
export class SessionPool {
  private readonly sessions = new Map<string, Session>();
  private admin: Session | null = null;

  constructor(private readonly adminEmail: string) {}

  async forMember(key: string): Promise<Session> {
    const cached = this.sessions.get(key);
    if (cached) return cached;
    const member = memberByKey(key);
    if (member.disabled === true || member.service === true) return this.forAdmin();
    try {
      const session = await login(member.email, SAMPLE_PASSWORD);
      this.sessions.set(key, session);
      return session;
    } catch {
      return this.forAdmin();
    }
  }

  async forAdmin(): Promise<Session> {
    this.admin ??= await login(this.adminEmail, SAMPLE_PASSWORD);
    return this.admin;
  }
}

/** Exécute `worker` sur chaque élément, `limit` en vol à la fois. */
async function inParallel<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export interface MediaSeedResult {
  /** Identifiants des médias déposés, par version. */
  byVersion: Map<number, MediaObject[]>;
  uploaded: number;
  failed: number;
}

export async function seedMedia(
  prisma: PrismaClient,
  seeded: SeededProject,
  pool: SessionPool,
  options: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<MediaSeedResult> {
  const byVersion = new Map<number, MediaObject[]>();
  const pending: number[] = [];
  const shotByCode = new Map<string, ShotSpec>();
  const episodeByShot = new Map<string, string | undefined>();
  for (const sequence of seeded.spec.sequences) {
    for (const shot of sequence.shots) {
      shotByCode.set(shot.code, shot);
      episodeByShot.set(shot.code, sequence.episode);
    }
  }
  const assetByName = new Map<string, AssetSpec>(
    seeded.spec.assets.map((a) => [a.name.replace(/\s+/g, ''), a]),
  );

  let done = 0;
  const total = seeded.versions.reduce((sum, v) => sum + v.planned.media.length, 0);

  const upload = async (entry: SeededVersion): Promise<void> => {
    const session = await pool.forMember(entry.planned.authorKey);
    for (const media of entry.planned.media) {
      const shot = shotByCode.get(entry.ownerCode);
      const asset = assetByName.get(entry.ownerCode);
      // Reprise : un média déjà déposé ne l'est pas deux fois. Sans cette garde, relancer
      // après un incident réseau doublerait tout ce qui était passé avant la coupure.
      const already = await prisma.mediaObject.findFirst({
        where: { versionId: entry.version.id, originalName: media.filename, deletedAt: null },
      });
      // Un dépôt en échec (fichier tronqué, coupure) est refait, pas conservé : le laisser
      // en place ferait croire la reprise terminée alors qu'il manque un livrable.
      if (already?.status === 'FAILED') {
        await prisma.mediaObject.delete({ where: { id: already.id } });
      } else if (already) {
        byVersion.set(entry.version.id, [...(byVersion.get(entry.version.id) ?? []), already]);
        if (already.status !== 'READY') pending.push(already.id);
        done += 1;
        options.onProgress?.(done, total);
        continue;
      }
      try {
        const produced = await produceFile({
          spec: seeded.spec,
          media: media.spec,
          filename: media.filename,
          ...(shot ? { shot } : {}),
          ...(asset ? { asset } : {}),
          ...(shot ? { episodeCode: episodeByShot.get(entry.ownerCode) } : {}),
          assets: seeded.spec.assets,
          folder: entry.ownerCode,
        });

        const uploaded = produced.frames
          ? await uploadSequence(
              session,
              entry.version.id,
              media.filename,
              produced.frames,
              seeded.spec.framerate,
            )
          : await uploadMedia(session, entry.version.id, produced.path, media.kind);

        // Un média déposé aujourd'hui sur une version d'il y a deux mois briserait la
        // chronologie : on le redate sur sa version, comme le reste du jeu de données.
        const record = await prisma.mediaObject.update({
          where: { id: uploaded.id },
          data: { createdAt: entry.planned.createdAt },
        });
        // Un brouillon n'est visible que de son auteur : on en garde quelques-uns pour
        // montrer l'état, et on publie tout le reste.
        if (entry.planned.status !== 'DRAFT' && !record.published) {
          await publishMedia(session, uploaded.id).catch(() => undefined);
        }
        byVersion.set(entry.version.id, [...(byVersion.get(entry.version.id) ?? []), record]);
        pending.push(uploaded.id);
      } catch (err) {
        console.warn(`  ! ${media.filename}: ${(err as Error).message.split('\n')[0]}`);
      }
      done += 1;
      options.onProgress?.(done, total);
    }
  };

  await inParallel(seeded.versions, options.concurrency ?? 3, upload);

  const admin = await pool.forAdmin();
  const result = await waitForProcessing(admin, pending, { timeoutMs: 45 * 60 * 1000 });
  return { byVersion, uploaded: result.ready.length, failed: result.failed.length };
}
