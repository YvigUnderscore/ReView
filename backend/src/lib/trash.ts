// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { storage } from '../services/StorageService';
import { enqueueStorageCleanup } from '../services/JobService';
import { logger } from './logger';

/**
 * Corbeille : soft-delete / restauration / purge définitive, avec cascade descendante
 * et nettoyage des objets MinIO à la purge.
 *
 * Cascade (soft-delete & restore) :
 *   Sequence → Shots
 *   Asset    → Versions → Médias
 *   Version  → Médias
 *   Shot / Média : pas d'enfant porteur de deletedAt
 *   Project  : marqué seul (ses listings sont déjà filtrés par projet visible)
 *
 * Note : la restauration d'un parent restaure aussi ses descendants supprimés.
 */

type MediaKeys = {
  id: number;
  storageKey: string;
  thumbnailKey: string | null;
  imageSequence?: { storagePrefix: string } | null;
};

/**
 * Ce qu'il faut lire sur un média pour pouvoir libérer tout ce qu'il occupe.
 *
 * `imageSequence.storagePrefix` est le seul endroit de la base qui nomme les frames d'une
 * séquence d'images (`projects/…/{mediaId}/frames/`). Tant que la purge ne le lisait pas,
 * détruire une livraison de 2 000 EXR effaçait la ligne et le manifeste mais laissait les
 * quatre-vingts gigaoctets de frames dans le bucket — sans plus rien en base pour les
 * nommer, donc introuvables autrement qu'en balayant le stockage à la main.
 */
const MEDIA_STORAGE_SELECT = {
  id: true,
  storageKey: true,
  thumbnailKey: true,
  imageSequence: { select: { storagePrefix: true } },
} as const;

/** Aplati les clés storage (média + miniature) d'une liste de médias. */
function mediaStorageKeys(medias: MediaKeys[]): string[] {
  const keys: string[] = [];
  for (const m of medias) {
    if (m.storageKey) keys.push(m.storageKey);
    if (m.thumbnailKey) keys.push(m.thumbnailKey);
  }
  return keys;
}

/**
 * Dossier propre à un média, déduit de sa clé source.
 *
 * `StorageService.mediaKey` range toujours un média dans un dossier qui porte son
 * identifiant : `projects/{projet}/{parent}/{version}/{mediaId}/{fichier}`. Ce dossier
 * n'appartient donc qu'à lui, et c'est là que vivent, à côté du fichier d'origine, le
 * manifeste `sequence.json` et le sous-dossier `frames/` d'une séquence d'images.
 *
 * Le suffixe `/{id}/` est EXIGÉ avant de rendre le préfixe : c'est la preuve que le
 * dossier est bien celui de ce média-là. Sans elle, une clé inattendue — vide (média créé
 * mais pas encore nommé), héritée d'une convention ancienne — ferait supprimer un préfixe
 * qui contient le travail de quelqu'un d'autre, voire le bucket entier. Aucun préfixe vaut
 * mieux qu'un préfixe trop large : les frames retomberaient alors sur `storagePrefix`.
 */
function mediaFolderPrefix(media: MediaKeys): string | null {
  const slash = media.storageKey.lastIndexOf('/');
  if (slash <= 0) return null;
  const folder = media.storageKey.slice(0, slash + 1);
  return folder.endsWith(`/${media.id}/`) ? folder : null;
}

/**
 * Préfixes MinIO qui n'appartiennent qu'à ces médias.
 *
 * Deux familles. (1) Tout ce que les workers fabriquent vit sous `derived/{mediaId}/` :
 * renditions HLS, proxy MP4, dérivé client, sprite de timeline, GLB converti, vignettes
 * spatiales, ops splat. Ces objets pèsent l'essentiel du bucket — une purge qui ne
 * supprimait que `storageKey` et `thumbnailKey` ne libérait presque rien, et pour une vidéo
 * rien du tout puisque l'original est déjà remplacé par son proxy à la fin du transcodage.
 * (2) Le dossier du média, qui emporte le fichier d'origine, le manifeste de séquence et
 * ses frames — et, par construction, tout dérivé qu'on rangerait demain à côté. Quand ce
 * dossier n'est pas démontrable (cf. `mediaFolderPrefix`), on se rabat sur le seul préfixe
 * de frames que la base connaisse.
 */
function mediaOwnedPrefixes(medias: MediaKeys[]): string[] {
  const prefixes: string[] = [];
  for (const media of medias) {
    prefixes.push(`derived/${media.id}/`);
    const folder = mediaFolderPrefix(media);
    if (folder) prefixes.push(folder);
    else if (media.imageSequence?.storagePrefix) prefixes.push(media.imageSequence.storagePrefix);
  }
  return prefixes;
}

/**
 * Préfixes traités de front. Chaque préfixe coûte au moins un `ListObjectsV2` suivi d'un
 * `DeleteObjects` : les enchaîner strictement un par un faisait de la purge de deux cents
 * médias plusieurs centaines d'allers-retours en série, dans le fil de la requête HTTP.
 * Huit suffisent à masquer la latence sans transformer un ménage en charge pour MinIO.
 */
const PREFIX_DELETE_CONCURRENCY = 8;

/**
 * Supprime les préfixes avec un parallélisme borné et renvoie ceux qui ont échoué, **dans
 * l'ordre d'entrée** — ce que le journal des orphelins réenfile doit rester reproductible.
 */
async function deletePrefixes(prefixes: string[]): Promise<string[]> {
  const failed: (string | null)[] = new Array<string | null>(prefixes.length).fill(null);
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const prefix = prefixes[index];
      if (prefix === undefined) return;
      try {
        await storage.deletePrefix(prefix);
      } catch (err) {
        failed[index] = prefix;
        logger.warn({ err, prefix }, '[Trash] suppression préfixe storage échouée (retry enfilé)');
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PREFIX_DELETE_CONCURRENCY, prefixes.length) }, () => run()),
  );
  return failed.filter((prefix): prefix is string => prefix !== null);
}

/**
 * Supprime des objets MinIO **après** que la DB a été purgée. Ne lève jamais : un
 * échec storage n'a plus d'impact sur la cohérence DB (déjà committée). Les clés en
 * échec sont journalisées et enfilées pour retry (journal des orphelins, cf. 10.D7).
 *
 * Les clés partent en **suppression multiple** (`DeleteObjects`, 1 000 par appel) plutôt
 * qu'une par une. Si le transport tombe, tout le lot est réenfilé au lieu des seules clés
 * réellement en échec : la suppression d'un objet déjà absent est sans effet, l'état final
 * du bucket est donc identique — on retente simplement un peu plus large.
 */
async function deleteStorageAfterCommit(keys: string[], prefixes: string[] = []): Promise<void> {
  let failedKeys: string[] = [];
  if (keys.length > 0) {
    try {
      failedKeys = await storage.deleteObjects(keys);
      if (failedKeys.length > 0)
        logger.warn({ keys: failedKeys }, '[Trash] suppression objet storage refusée (retry enfilé)');
    } catch (err) {
      failedKeys = [...keys];
      logger.warn({ err, count: keys.length }, '[Trash] suppression objets storage échouée (retry enfilé)');
    }
  }
  const failedPrefixes = await deletePrefixes(prefixes);
  if (failedKeys.length > 0 || failedPrefixes.length > 0) {
    await enqueueStorageCleanup({ keys: failedKeys, prefixes: failedPrefixes }).catch((err) =>
      logger.error(
        { err, keys: failedKeys, prefixes: failedPrefixes },
        "[Trash] impossible d'enfiler le nettoyage storage — orphelins non retentés",
      ),
    );
  }
}

// ── Soft-delete ───────────────────────────────────────────────────────────────

export async function softDeleteSequence(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: id }, data: { deletedAt: now } }),
    prisma.sequence.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteShot(id: number): Promise<void> {
  await prisma.shot.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Épisode : aucune cascade, contrairement à la séquence.
 *
 * Un épisode regroupe des séquences, il ne les possède pas. Emporter avec lui ses
 * séquences — et derrière elles les plans, les versions et les commentaires — ferait
 * d'un geste de rangement une destruction de production. Le rattachement (`episodeId`)
 * est conservé tel quel : la restauration rend l'épisode exactement comme il était.
 */
export async function softDeleteEpisode(id: number): Promise<void> {
  await prisma.episode.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function softDeleteAsset(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: id } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { assetId: id }, data: { deletedAt: now } }),
    prisma.asset.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteVersion(id: number): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: id }, data: { deletedAt: now } }),
    prisma.version.update({ where: { id }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteMedia(id: number): Promise<void> {
  await prisma.mediaObject.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function softDeleteProject(id: number): Promise<void> {
  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ── Soft-delete en lot (13.C) ─────────────────────────────────────────────────
// Une seule transaction par domaine (updateMany), cascade descendante identique au
// singulier. Les ids ont déjà été validés (accès projet) par le BulkService appelant.

export async function softDeleteSequences(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: { in: ids } }, data: { deletedAt: now } }),
    prisma.sequence.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteShots(ids: number[]): Promise<void> {
  await prisma.shot.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteEpisodes(ids: number[]): Promise<void> {
  await prisma.episode.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteAssets(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: { in: ids } } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { assetId: { in: ids } }, data: { deletedAt: now } }),
    prisma.asset.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteVersions(ids: number[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: { in: ids } }, data: { deletedAt: now } }),
    prisma.version.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
  ]);
}

export async function softDeleteMedias(ids: number[]): Promise<void> {
  await prisma.mediaObject.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function softDeleteProjects(ids: number[]): Promise<void> {
  await prisma.project.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

// ── Restauration ────────────────────────────────────────────────────────────────

export async function restoreSequence(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: id }, data: { deletedAt: null } }),
    prisma.sequence.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreShot(id: number): Promise<void> {
  await prisma.shot.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreEpisode(id: number): Promise<void> {
  await prisma.episode.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreAsset(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { version: { assetId: id } }, data: { deletedAt: null } }),
    prisma.version.updateMany({ where: { assetId: id }, data: { deletedAt: null } }),
    prisma.asset.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreVersion(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: id }, data: { deletedAt: null } }),
    prisma.version.update({ where: { id }, data: { deletedAt: null } }),
  ]);
}

export async function restoreMedia(id: number): Promise<void> {
  await prisma.mediaObject.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreProject(id: number): Promise<void> {
  await prisma.project.update({ where: { id }, data: { deletedAt: null } });
}

// ── Restauration en lot (13.C) ────────────────────────────────────────────────

export async function restoreSequences(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.shot.updateMany({ where: { sequenceId: { in: ids } }, data: { deletedAt: null } }),
    prisma.sequence.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreShots(ids: number[]): Promise<void> {
  await prisma.shot.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreEpisodes(ids: number[]): Promise<void> {
  await prisma.episode.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreAssets(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({
      where: { version: { assetId: { in: ids } } },
      data: { deletedAt: null },
    }),
    prisma.version.updateMany({ where: { assetId: { in: ids } }, data: { deletedAt: null } }),
    prisma.asset.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreVersions(ids: number[]): Promise<void> {
  await prisma.$transaction([
    prisma.mediaObject.updateMany({ where: { versionId: { in: ids } }, data: { deletedAt: null } }),
    prisma.version.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
  ]);
}

export async function restoreMedias(ids: number[]): Promise<void> {
  await prisma.mediaObject.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function restoreProjects(ids: number[]): Promise<void> {
  await prisma.project.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

// ── Purge définitive (DB + MinIO) ────────────────────────────────────────────────

// Invariant 10.D7 : la suppression DB (atomique via cascade) précède TOUJOURS la
// suppression storage. Un échec MinIO ne laisse donc jamais la DB incohérente ;
// les objets orphelins sont journalisés et retentés (deleteStorageAfterCommit).

export async function purgeMedia(id: number): Promise<void> {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: MEDIA_STORAGE_SELECT,
  });
  if (!media) return;
  await prisma.mediaObject.delete({ where: { id } });
  await deleteStorageAfterCommit(mediaStorageKeys([media]), mediaOwnedPrefixes([media]));
}

export async function purgeVersion(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { versionId: id },
    select: MEDIA_STORAGE_SELECT,
  });
  await prisma.version.delete({ where: { id } }); // cascade DB des médias
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeShot(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { version: { task: { shotId: id } } },
    select: MEDIA_STORAGE_SELECT,
  });
  await prisma.shot.delete({ where: { id } }); // cascade DB : tasks → versions → médias
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeAsset(id: number): Promise<void> {
  const medias = await prisma.mediaObject.findMany({
    where: { version: { OR: [{ assetId: id }, { task: { assetId: id } }] } },
    select: MEDIA_STORAGE_SELECT,
  });
  await prisma.asset.delete({ where: { id } });
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeSequence(id: number): Promise<void> {
  // La suppression d'une séquence remet sequenceId à null sur ses shots (SetNull) :
  // aucun média à purger ici.
  await prisma.sequence.delete({ where: { id } });
}

/**
 * Purge d'un épisode. Ses séquences survivent, simplement détachées (`ON DELETE SET
 * NULL`) : un épisode est un regroupement, pas un propriétaire — le détruire ne doit
 * emporter ni plan, ni version, ni commentaire. Aucun objet MinIO à retirer.
 */
export async function purgeEpisode(id: number): Promise<void> {
  await prisma.episode.delete({ where: { id } });
}

export async function purgeProject(id: number): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id }, select: { slug: true } });
  if (!project) return;
  await prisma.project.delete({ where: { id } }); // cascade DB intégrale
  // Storage après commit — nouvelles clés lisibles + anciennes clés numériques (legacy).
  await deleteStorageAfterCommit([], [`projects/${project.slug}/`, `projects/${id}/`]);
}

// ── Purge définitive en lot (13.C) ───────────────────────────────────────────────

/**
 * Purge groupée, pendant exact des `softDelete*`/`restore*` pluriels.
 *
 * La voie groupée appelait jusqu'ici la purge unitaire dans une boucle : deux cents médias
 * coûtaient deux cents lectures, deux cents suppressions et quatre cents allers-retours
 * MinIO en série, le tout dans le fil de la requête HTTP. Ici le lot est lu en une passe,
 * supprimé en une passe, et le stockage nettoyé en un seul `DeleteObjects` suivi des
 * préfixes en parallélisme borné.
 *
 * Même invariant 10.D7 : la DB d'abord, le stockage ensuite. Une différence assumée avec
 * la boucle unitaire : un `deleteMany` est tout ou rien là où la boucle laissait derrière
 * elle les éléments déjà purgés. Le chemin nominal, lui, produit exactement le même état.
 * Les ids ont déjà été validés (accès projet) par le BulkService appelant.
 */
const byIdAsc = { orderBy: { id: 'asc' } } as const;

export async function purgeMedias(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const medias = await prisma.mediaObject.findMany({
    where: { id: { in: ids } },
    select: MEDIA_STORAGE_SELECT,
    ...byIdAsc,
  });
  await prisma.mediaObject.deleteMany({ where: { id: { in: ids } } });
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeVersions(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const medias = await prisma.mediaObject.findMany({
    where: { versionId: { in: ids } },
    select: MEDIA_STORAGE_SELECT,
    ...byIdAsc,
  });
  await prisma.version.deleteMany({ where: { id: { in: ids } } }); // cascade DB des médias
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeShots(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const medias = await prisma.mediaObject.findMany({
    where: { version: { task: { shotId: { in: ids } } } },
    select: MEDIA_STORAGE_SELECT,
    ...byIdAsc,
  });
  await prisma.shot.deleteMany({ where: { id: { in: ids } } }); // cascade : tasks → versions → médias
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

export async function purgeAssets(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const medias = await prisma.mediaObject.findMany({
    where: { version: { OR: [{ assetId: { in: ids } }, { task: { assetId: { in: ids } } }] } },
    select: MEDIA_STORAGE_SELECT,
    ...byIdAsc,
  });
  await prisma.asset.deleteMany({ where: { id: { in: ids } } });
  await deleteStorageAfterCommit(mediaStorageKeys(medias), mediaOwnedPrefixes(medias));
}

/** Séquences : leurs shots sont détachés (SetNull), aucun objet MinIO à retirer. */
export async function purgeSequences(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.sequence.deleteMany({ where: { id: { in: ids } } });
}

/** Épisodes : leurs séquences sont détachées (SetNull), aucun objet MinIO à retirer. */
export async function purgeEpisodes(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.episode.deleteMany({ where: { id: { in: ids } } });
}

export async function purgeProjects(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const projects = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true },
    ...byIdAsc,
  });
  if (projects.length === 0) return;
  await prisma.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
  // Nouvelles clés lisibles + anciennes clés numériques (legacy), comme au singulier.
  await deleteStorageAfterCommit(
    [],
    projects.flatMap((p) => [`projects/${p.slug}/`, `projects/${p.id}/`]),
  );
}

// ── Purge automatique (balayage planifié) ────────────────────────────────────────

/**
 * Plafond d'une passe de purge automatique. Chaque élément coûte une transaction DB **et**
 * un ou plusieurs appels MinIO : vider d'un coup la corbeille d'un long-métrage occuperait
 * le worker des heures et martèlerait le stockage pendant que le studio travaille. La purge
 * est idempotente et reprend là où elle s'est arrêtée à la passe suivante.
 */
export const TRASH_PURGE_MAX_ITEMS = 2000;

/**
 * Purge définitivement tout élément en corbeille depuis plus de `retentionDays` jours, dans
 * la limite de `maxItems` éléments par passe.
 * `retentionDays <= 0` désactive la purge automatique (no-op).
 * Ordre : enfants avant parents pour éviter les conflits de cascade.
 */
export async function purgeExpiredTrash(
  retentionDays: number,
  maxItems: number = TRASH_PURGE_MAX_ITEMS,
): Promise<number> {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const expired = { deletedAt: { lt: cutoff, not: null } } as const;
  let budget = Math.max(0, Math.trunc(maxItems));
  let purged = 0;

  /** Consomme le budget restant sur un niveau de la hiérarchie, du plus ancien au plus récent. */
  const sweep = async (
    find: (take: number) => Promise<{ id: number }[]>,
    purgeOne: (id: number) => Promise<void>,
  ): Promise<void> => {
    if (budget <= 0) return;
    for (const row of await find(budget)) {
      await purgeOne(row.id);
      purged += 1;
      budget -= 1;
    }
  };

  const page = { where: expired, select: { id: true }, orderBy: { id: 'asc' } } as const;
  await sweep((take) => prisma.mediaObject.findMany({ ...page, take }), purgeMedia);
  await sweep((take) => prisma.version.findMany({ ...page, take }), purgeVersion);
  await sweep((take) => prisma.shot.findMany({ ...page, take }), purgeShot);
  await sweep((take) => prisma.sequence.findMany({ ...page, take }), purgeSequence);
  // Après les séquences : elles ne dépendent pas de leur épisode (SetNull), mais l'ordre
  // enfants → parents reste la règle du balayage.
  await sweep((take) => prisma.episode.findMany({ ...page, take }), purgeEpisode);
  await sweep((take) => prisma.asset.findMany({ ...page, take }), purgeAsset);
  await sweep((take) => prisma.project.findMany({ ...page, take }), purgeProject);

  return purged;
}
