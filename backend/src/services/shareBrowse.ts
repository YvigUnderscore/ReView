// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tidying of what a share link opens: "review / sequences / shots / assets".
 *
 * **Pure** module: no query, no disk access. It receives the rows that `ClientShareService` has already filtered by scope
 * (`shareMediaWhere`) and tidies them. This is the only way to guarantee that a MEDIA-scope link does not name the neighbouring
 * shot: one can only tidy what has already gone through the filter, and never query the project's shot table.
 *
 * Second invariant: **a media tile exists only once**, in the `media` array of the response. The nodes carry only identifiers,
 * including their cover thumbnail (`coverMediaId`). One more presigned URL per node would take the opening of a page from 201
 * signatures to several hundred.
 */

/** What needs to be known about a media to tidy it: structural shape of the Prisma `select`. */
export interface ShareTreeRow {
  id: number;
  thumbnailKey: string | null;
  version: {
    /** Version set directly on an asset, without going through a task. */
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
  /** Nullable: a shot without a sequence is a normal case, not an anomaly. */
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
  /** All the media of the sequence, shots combined, in the order of the `media` array. */
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
  /** Studio label when one has been defined (`Asset.typeLabel`). */
  typeLabel: string | null;
  mediaIds: number[];
  coverMediaId: number | null;
}

/** The tree as the public page consumes it. */
export interface ShareBrowse {
  episodes: ShareEpisodeNode[];
  sequences: ShareSequenceNode[];
  shots: ShareShotNode[];
  assets: ShareAssetNode[];
  /** Media that no parent claims: never lost from the screen, never named. */
  looseMediaIds: number[];
}

/** Retrieves a card's entry, or creates it there. */
function ensure<T>(map: Map<number, T>, key: number, make: () => T): T {
  const found = map.get(key);
  if (found) return found;
  const made = make();
  map.set(key, made);
  return made;
}

/** Production order: the studio rank first, the code to break ties. */
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
    // A version may hang from an asset either through its task OR directly: both paths lead to the SAME node,
    // otherwise an asset would appear twice in the tab.
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
      // `??=`: the cover is the first media THAT HAS a thumbnail. A media without a thumbnail does not take the
      // place nor leave the card grey.
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
      // Forbidden by the `Task_parent_xor` / `Version_parent_xor` constraints, but degraded data must not make a
      // media disappear from the client's screen.
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
