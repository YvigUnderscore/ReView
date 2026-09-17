// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Rangement de ce qu'un lien de partage ouvre : « review / sequences / shots / assets ».
 *
 * Module **pur** — aucune requête, aucun accès disque. Il reçoit les lignes que
 * `ClientShareService` a déjà filtrées par la portée (`shareMediaWhere`) et les range. C'est
 * la seule façon de garantir qu'un lien de portée MEDIA ne nomme pas le plan voisin : on ne
 * peut ranger que ce qui est déjà passé par le filtre, et jamais interroger la table des
 * plans du projet.
 *
 * Deuxième invariant : **une tuile de média n'existe qu'une fois**, dans le tableau `media`
 * de la réponse. Les nœuds ne portent que des identifiants — y compris leur vignette de
 * couverture (`coverMediaId`). Une URL présignée de plus par nœud ferait passer l'ouverture
 * d'une page de 201 signatures à plusieurs centaines.
 */

/** Ce qu'il faut savoir d'un média pour le ranger — forme structurelle du `select` Prisma. */
export interface ShareTreeRow {
  id: number;
  thumbnailKey: string | null;
  version: {
    /** Version posée directement sur un asset, sans passer par une tâche. */
    asset: ShareAssetSource | null;
    task: {
      asset: ShareAssetSource | null;
      shot: ShareShotSource | null;
    } | null;
  };
}

interface ShareAssetSource {
  id: number;
  name: string;
  type: string;
  typeLabel: string | null;
}

interface ShareShotSource {
  id: number;
  code: string;
  name: string;
  order: number;
  /** Nullable : un plan sans séquence est un cas normal, pas une anomalie. */
  sequence: {
    id: number;
    code: string;
    name: string;
    order: number;
    episode: { id: number; code: string; name: string; order: number } | null;
  } | null;
}

export interface ShareEpisodeNode {
  id: number;
  code: string;
  name: string;
  order: number;
  sequenceIds: number[];
}

export interface ShareSequenceNode {
  id: number;
  code: string;
  name: string;
  order: number;
  episodeId: number | null;
  shotIds: number[];
  /** Tous les médias de la séquence, plans confondus, dans l'ordre du tableau `media`. */
  mediaIds: number[];
  coverMediaId: number | null;
}

export interface ShareShotNode {
  id: number;
  code: string;
  name: string;
  order: number;
  sequenceId: number | null;
  mediaIds: number[];
  coverMediaId: number | null;
}

export interface ShareAssetNode {
  id: number;
  name: string;
  type: string;
  /** Libellé du studio quand il en a défini un (`Asset.typeLabel`). */
  typeLabel: string | null;
  mediaIds: number[];
  coverMediaId: number | null;
}

/** L'arborescence telle que la page publique la consomme. */
export interface ShareBrowse {
  episodes: ShareEpisodeNode[];
  sequences: ShareSequenceNode[];
  shots: ShareShotNode[];
  assets: ShareAssetNode[];
  /** Médias qu'aucun parent ne réclame : jamais perdus de l'écran, jamais nommés. */
  looseMediaIds: number[];
}

/** Récupère l'entrée d'une carte, ou l'y crée. */
function ensure<T>(map: Map<number, T>, key: number, make: () => T): T {
  const found = map.get(key);
  if (found) return found;
  const made = make();
  map.set(key, made);
  return made;
}

/** Ordre de production : le rang du studio d'abord, le code pour départager. */
const byOrder = (a: { order: number; code: string }, b: { order: number; code: string }): number =>
  a.order - b.order || a.code.localeCompare(b.code);

export function buildShareBrowse(rows: readonly ShareTreeRow[]): ShareBrowse {
  const episodes = new Map<number, ShareEpisodeNode>();
  const sequences = new Map<number, ShareSequenceNode>();
  const shots = new Map<number, ShareShotNode>();
  const assets = new Map<number, ShareAssetNode>();
  const looseMediaIds: number[] = [];

  for (const row of rows) {
    const shot = row.version.task?.shot ?? null;
    // Une version peut pendre à un asset par sa tâche OU directement : les deux chemins
    // mènent au MÊME nœud, sans quoi un asset apparaîtrait deux fois dans l'onglet.
    const asset = row.version.asset ?? row.version.task?.asset ?? null;

    if (shot) {
      const shotNode = ensure(shots, shot.id, () => ({
        id: shot.id,
        code: shot.code,
        name: shot.name,
        order: shot.order,
        sequenceId: shot.sequence?.id ?? null,
        mediaIds: [],
        coverMediaId: null,
      }));
      shotNode.mediaIds.push(row.id);
      // `??=` : la couverture est le premier média QUI A une miniature. Un média sans
      // vignette ne confisque pas la place et ne laisse pas la carte grise.
      if (shotNode.coverMediaId === null && row.thumbnailKey) shotNode.coverMediaId = row.id;

      const sequence = shot.sequence;
      if (sequence) {
        const sequenceNode = ensure(sequences, sequence.id, () => ({
          id: sequence.id,
          code: sequence.code,
          name: sequence.name,
          order: sequence.order,
          episodeId: sequence.episode?.id ?? null,
          shotIds: [],
          mediaIds: [],
          coverMediaId: null,
        }));
        if (!sequenceNode.shotIds.includes(shot.id)) sequenceNode.shotIds.push(shot.id);
        sequenceNode.mediaIds.push(row.id);
        if (sequenceNode.coverMediaId === null && row.thumbnailKey) sequenceNode.coverMediaId = row.id;

        const episode = sequence.episode;
        if (episode) {
          const episodeNode = ensure(episodes, episode.id, () => ({
            id: episode.id,
            code: episode.code,
            name: episode.name,
            order: episode.order,
            sequenceIds: [],
          }));
          if (!episodeNode.sequenceIds.includes(sequence.id)) episodeNode.sequenceIds.push(sequence.id);
        }
      }
    } else if (asset) {
      const assetNode = ensure(assets, asset.id, () => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        typeLabel: asset.typeLabel,
        mediaIds: [],
        coverMediaId: null,
      }));
      assetNode.mediaIds.push(row.id);
      if (assetNode.coverMediaId === null && row.thumbnailKey) assetNode.coverMediaId = row.id;
    } else {
      // Interdit par les contraintes `Task_parent_xor` / `Version_parent_xor` — mais une
      // donnée dégradée ne doit pas faire disparaître un média de l'écran du client.
      looseMediaIds.push(row.id);
    }
  }

  return {
    episodes: [...episodes.values()].sort(byOrder),
    sequences: [...sequences.values()].sort(byOrder),
    shots: [...shots.values()].sort(byOrder),
    assets: [...assets.values()].sort((a, b) => a.name.localeCompare(b.name)),
    looseMediaIds,
  };
}
