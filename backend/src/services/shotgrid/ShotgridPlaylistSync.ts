// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { writeAllowedOn } from './shotgridTemplateGuard';
import { asDate, asEntityRefs, asString, type SgEntityRef, type SgRecord } from './shotgridMapper';
import { findByLocal, mapLocalToSg, mapSgToLocal, upsertLink } from './shotgridLinks';
import { can } from './shotgridSettings';
import { touch, type PullContext } from './ShotgridPullService';

/**
 * Playlists ShotGrid ↔ playlists de dailies.
 *
 * Une playlist prépare une séance de review : elle est constituée dans l'outil où l'on
 * travaille, et doit être jouable dans celui où l'on projette. L'ordre compte autant
 * que le contenu — une séance suit un déroulé, pas un ensemble.
 */

const PLAYLIST_FIELDS = ['code', 'description', 'versions', 'created_at', 'updated_at', 'project'];

export interface PlaylistPullOptions {
  /** Playlists précises à relire (traitement d'un événement). */
  onlySgIds?: number[];
}

/**
 * Import des playlists du projet.
 *
 * Seules les versions déjà connues de ReView entrent : une playlist ShotGrid peut citer
 * des versions que le filtre de statuts a écartées à l'import, et les inventer ici
 * fabriquerait des entrées qui ne mènent nulle part. L'ordre de ShotGrid est conservé.
 */
export async function pullPlaylists(ctx: PullContext, options: PlaylistPullOptions = {}): Promise<void> {
  if (!can(ctx.settings, 'playlists', 'read')) return;

  // Restriction cumulative : le filtre de projet reste posé même quand on ne relit
  // qu'une playlist désignée par un événement, et chaque enregistrement est revérifié.
  const filters: Array<[string, string, unknown]> = [projectFilter(ctx.scope.sgProjectId)];
  if (options.onlySgIds?.length) filters.push(['id', 'in', options.onlySgIds]);

  const records = await ctx.client.search('Playlist', {
    fields: PLAYLIST_FIELDS,
    filters,
    sort: '-id',
    maxRecords: options.onlySgIds?.length ?? 200,
  });

  const versionLinks = await mapSgToLocal(ctx.connection.id, 'version');
  const playlistLinks = await mapSgToLocal(ctx.connection.id, 'playlist');

  for (const record of records) {
    if (!belongsToProject(record, ctx.scope).ok) {
      ctx.journal.count('guard', 'skipped');
      continue;
    }
    const name = asString(record.code);
    if (!name) continue;

    const versionIds = asEntityRefs(record.versions)
      .map((r) => versionLinks.get(r.id)?.localId)
      .filter((id): id is number => typeof id === 'number');

    /*
     * Retrouver la playlist locale, dans cet ordre : le lien, puis le nom.
     *
     * Le repli sur le nom vaut **aussi quand le lien existe** : il peut désigner une
     * playlist supprimée depuis, et une création aveugle butait alors sur la contrainte
     * `(projectId, name)` — la synchronisation entière s'arrêtait pour une playlist
     * effacée à la main des mois plus tôt.
     */
    const link = playlistLinks.get(record.id);
    const linked = link ? await prisma.playlist.findUnique({ where: { id: link.localId } }) : null;
    const byName = await prisma.playlist.findUnique({
      where: { projectId_name: { projectId: ctx.connection.projectId, name } },
    });
    const existing = linked ?? byName;

    /*
     * Renommage côté ShotGrid vers un nom déjà porté par une AUTRE playlist locale : on
     * garde le nom actuel plutôt que de faire échouer le lot. Fusionner deux séances ou en
     * écraser une n'est pas une décision qu'une synchronisation prend toute seule ; le
     * conflit se voit au journal, et se tranche à la main.
     */
    const renameCollides = Boolean(linked && byName && byName.id !== linked.id);
    if (renameCollides) {
      ctx.journal.count('playlists', 'skipped');
      await ctx.journal.log(
        'conflict',
        'shotgrid.log.playlistNameTaken',
        { name },
        { sgType: 'Playlist', sgId: record.id, localType: 'playlist', localId: linked!.id },
      );
    }

    const playlist = existing
      ? await prisma.playlist.update({
          where: { id: existing.id },
          data: renameCollides ? {} : { name },
        })
      : await prisma.playlist.create({ data: { projectId: ctx.connection.projectId, name } });

    // Le contenu est remplacé, pas complété : une version retirée côté ShotGrid doit
    // disparaître de la séance, et repasser deux fois ne doit rien dupliquer.
    await prisma.playlistItem.deleteMany({ where: { playlistId: playlist.id } });
    if (versionIds.length > 0) {
      await prisma.playlistItem.createMany({
        data: versionIds.map((versionId, order) => ({ playlistId: playlist.id, versionId, order })),
        skipDuplicates: true,
      });
    }

    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'playlist',
      localId: playlist.id,
      sgType: 'Playlist',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: { versionCount: versionIds.length },
    });
    touch(ctx, 'playlist', playlist.id);
    ctx.journal.count('playlists', existing ? 'updated' : 'created');
  }
}

/** Champs relus sur la playlist distante avant d'y écrire. */
const PLAYLIST_PUSH_FIELDS = ['id', 'code', 'project', 'versions'];

export interface PlaylistPushContext {
  connectionId: number;
  sgProjectId: number;
  /**
   * Nom du projet lié, quand l'appelant l'a sous la main. Il n'entre pas dans la
   * décision d'appartenance — `belongsToProject` ne tranche que sur l'identifiant — et
   * ne sert qu'à compléter la portée partagée avec le reste du dossier.
   */
  sgProjectName?: string | null;
  client: {
    create: (entity: string, data: Record<string, unknown>) => Promise<{ id: number }>;
    update: (
      entity: string,
      id: number,
      data: Record<string, unknown>,
      options?: { asUserLogin?: string | null },
    ) => Promise<unknown>;
    findById: (entity: string, id: number, fields: string[]) => Promise<SgRecord | null>;
  };
  asUserLogin: string | null;
}

type SgRef = { type: string; id: number };

/**
 * Fusion du contenu d'une playlist : ce que ReView a le droit de dire, et rien de plus.
 *
 * Le champ `versions` d'une playlist ShotGrid ne se modifie pas par ajout ou retrait :
 * notre client l'écrit d'un bloc (PUT), il faut donc le relire, le fusionner, puis le
 * réécrire entier. Écrire la seule vue de ReView effaçait tout ce que le studio avait
 * posé directement sur le site — une perte qui ne se rattrape pas. L'invariant :
 *
 * - une version distante que ReView **ne connaît pas** (aucune correspondance pour cette
 *   connexion, donc aucune version de ce projet) est **préservée telle quelle**, à sa
 *   place dans l'ordre — c'est aussi ce qui protège une entité d'un autre projet, jamais
 *   déplacée ni retirée par une décision prise ici ;
 * - une version **ajoutée** côté ReView est ajoutée ;
 * - une version **retirée** côté ReView n'est retirée à distance que si ReView la
 *   connaissait ; sinon on n'y touche pas.
 *
 * L'ordre : les emplacements occupés par des versions connues sont recomposés dans
 * l'ordre de la séance ReView (une playlist est un déroulé, le réordonnancement doit
 * partir), les versions inconnues gardent leur position, et le surplus local s'ajoute à
 * la fin. Une version inconnue ne peut donc pas être doublée par le local : ReView ne
 * cite que des versions qu'il connaît.
 *
 * La lecture puis l'écriture ne forment pas une opération atomique — l'API n'offre rien
 * de tel. Une modification distante glissée entre les deux serait perdue ; c'est
 * précisément pourquoi on ne retire que ce que ReView possède légitimement.
 */
export function mergePlaylistVersions(params: {
  remote: readonly SgEntityRef[];
  local: readonly number[];
  known: ReadonlySet<number>;
}): SgRef[] {
  const { remote, local, known } = params;
  const pending = [...local];
  const merged: SgRef[] = [];

  for (const entry of remote) {
    // Inconnue de ReView (ou d'un autre type que Version) : intouchable, à sa place.
    if (entry.type !== 'Version' || !known.has(entry.id)) {
      merged.push({ type: entry.type, id: entry.id });
      continue;
    }
    // Emplacement que ReView gouverne : il reçoit la version suivante de la séance,
    // ou disparaît si la séance n'en a plus (retrait effectué dans ReView).
    const next = pending.shift();
    if (next !== undefined) merged.push({ type: 'Version', id: next });
  }

  for (const id of pending) merged.push({ type: 'Version', id });
  return merged;
}

/** Deux listes de références décrivent-elles le même contenu, dans le même ordre ? */
function sameRefs(a: readonly SgRef[], b: readonly SgRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref.type === b[i]!.type && ref.id === b[i]!.id);
}

/**
 * Envoi d'une playlist vers ShotGrid.
 *
 * Une playlist déjà liée est mise à jour plutôt que recréée — sans quoi chaque
 * modification laisserait une séance de plus dans la liste du studio. Les versions non
 * reliées sont ignorées : elles n'existent pas là-bas.
 */
export async function pushPlaylist(ctx: PlaylistPushContext, playlistId: number): Promise<number | null> {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: { items: { orderBy: { order: 'asc' }, select: { versionId: true } } },
  });
  if (!playlist) return null;

  /*
   * Une seule lecture de la table de correspondance sert deux besoins : traduire les
   * versions de la séance, et savoir lesquelles ReView connaît. Les liens sont portés
   * par la connexion, elle-même attachée à un unique projet : cet ensemble ne contient
   * donc que des versions du projet lié, ce qui fait de lui la bonne frontière pour
   * décider ce que ReView a le droit de retirer là-bas.
   */
  const versionLinks = await mapLocalToSg(ctx.connectionId, 'version');
  const known = new Set<number>();
  for (const link of versionLinks.values()) {
    if (link.sgType === 'Version') known.add(link.sgId);
  }

  const localSgIds: number[] = [];
  for (const item of playlist.items) {
    const link = versionLinks.get(item.versionId);
    if (link?.sgType === 'Version' && !localSgIds.includes(link.sgId)) localSgIds.push(link.sgId);
  }

  const existing = await findByLocal(ctx.connectionId, 'playlist', playlist.id);
  if (existing) {
    return updateRemotePlaylist(
      ctx,
      { id: playlist.id, name: playlist.name },
      existing.sgId,
      localSgIds,
      known,
    );
  }

  const created = await ctx.client.create('Playlist', {
    project: { type: 'Project', id: ctx.sgProjectId },
    code: playlist.name,
    versions: localSgIds.map((id) => ({ type: 'Version', id })),
  });
  await upsertLink({
    connectionId: ctx.connectionId,
    localType: 'playlist',
    localId: playlist.id,
    sgType: 'Playlist',
    sgId: created.id,
    data: { createdFromReview: true },
  });
  logger.info({ playlistId, sgId: created.id }, 'Playlist créée dans ShotGrid');
  return created.id;
}

/**
 * Mise à jour d'une playlist existante : relire, fusionner, n'écrire que si nécessaire.
 *
 * Les trois vérifications d'avant-écriture du dossier sont refaites ici, car l'envoi de
 * playlist ne passe pas par `resolveTarget` : la cible existe-t-elle encore, appartient-
 * elle bien au projet lié (un identifiant peut avoir été réattribué), et n'est-elle pas
 * dans un projet modèle. Chacune abandonne au lieu de lever — une écriture refusée se
 * journalise, elle n'interrompt pas la file.
 */
async function updateRemotePlaylist(
  ctx: PlaylistPushContext,
  playlist: { id: number; name: string },
  sgId: number,
  localSgIds: readonly number[],
  known: ReadonlySet<number>,
): Promise<number | null> {
  const remote = await ctx.client.findById('Playlist', sgId, PLAYLIST_PUSH_FIELDS);
  if (!remote) {
    // Le lien survit à la playlist qu'il désigne. La recréer remettrait dans le studio
    // une séance que quelqu'un a supprimée : on s'arrête et on le dit.
    logger.warn({ playlistId: playlist.id, sgId }, 'Playlist ShotGrid introuvable — écriture abandonnée');
    return null;
  }

  const verdict = belongsToProject(remote, {
    sgProjectId: ctx.sgProjectId,
    sgProjectName: ctx.sgProjectName ?? '',
  });
  if (!verdict.ok) {
    logger.error(
      { playlistId: playlist.id, sgId, expected: ctx.sgProjectId, found: verdict.foundProjectId },
      'Écriture de playlist annulée : la cible appartient à un autre projet',
    );
    return null;
  }
  if (!writeAllowedOn(remote)) {
    logger.error(
      { playlistId: playlist.id, sgId },
      'Écriture de playlist annulée : cible dans un projet modèle',
    );
    return null;
  }

  const remoteRefs = asEntityRefs(remote.versions);
  const merged = mergePlaylistVersions({ remote: remoteRefs, local: localSgIds, known });
  const preserved = merged.filter((ref) => ref.type !== 'Version' || !known.has(ref.id)).length;

  // Rien à dire de neuf : ne pas écrire évite un aller-retour d'événements avec le site,
  // et une trace de modification dans l'historique du studio pour une passe à vide.
  if (asString(remote.code) === playlist.name && sameRefs(remoteRefs, merged)) {
    logger.info({ playlistId: playlist.id, sgId }, 'Playlist ShotGrid déjà à jour — aucune écriture');
    return sgId;
  }

  await ctx.client.update(
    'Playlist',
    sgId,
    { code: playlist.name, versions: merged },
    { asUserLogin: ctx.asUserLogin },
  );
  logger.info(
    { playlistId: playlist.id, sgId, versions: merged.length, preserved },
    'Playlist mise à jour dans ShotGrid',
  );
  return sgId;
}
