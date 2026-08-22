// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Quelles passes exécuter, et sur quelles entités.
 *
 * Une synchronisation ShotGrid est une suite de passes (référentiel de statuts, comptes,
 * séquences, plans, assets, tâches, versions, publishes, notes, playlists). Les
 * déclencher toutes à chaque fois avait deux conséquences opposées, toutes deux fausses :
 *
 * - un événement portant sur UNE version rejouait le projet entier — des milliers de
 *   requêtes pour une entité qui a bougé ;
 * - un événement Note ou Playlist ne déclenchait RIEN, parce que le seul interrupteur
 *   disponible (`withMedia`) valait `entity === 'Version'`, donc faux. Le sens sortant
 *   fonctionnait, le sens entrant était mort.
 *
 * Ce module tranche : à chaque type d'événement sa liste de passes, et rien d'autre.
 * Il est volontairement pur — aucune base, aucun client — pour être vérifiable seul.
 */

export type SyncPass =
  | 'statuses'
  | 'users'
  | 'sequences'
  | 'shots'
  | 'assets'
  | 'tasks'
  | 'versions'
  | 'publishedFiles'
  | 'notes'
  | 'playlists';

export const ALL_PASSES: readonly SyncPass[] = [
  'statuses',
  'users',
  'sequences',
  'shots',
  'assets',
  'tasks',
  'versions',
  'publishedFiles',
  'notes',
  'playlists',
];

/**
 * Passe « structure seule » — ce que demandait historiquement `withMedia: false`.
 * Notes et playlists en sont exclues parce qu'elles s'appuient sur les versions.
 */
export const STRUCTURE_PASSES: readonly SyncPass[] = [
  'statuses',
  'users',
  'sequences',
  'shots',
  'assets',
  'tasks',
];

/**
 * Passes déclenchées par chaque type d'événement du site.
 *
 * Le référentiel de statuts accompagne toute passe qui lit un `sg_status_list` : sans
 * lui, `statusPatch` ne reconnaît aucun code et le journal se remplit de « statut
 * inconnu ». Les assets n'en portent pas côté ReView, ils s'en passent.
 */
const PASSES_BY_ENTITY: Readonly<Record<string, readonly SyncPass[]>> = {
  Sequence: ['statuses', 'sequences'],
  Shot: ['statuses', 'shots'],
  Asset: ['assets'],
  Task: ['statuses', 'users', 'tasks'],
  Version: ['versions'],
  Note: ['notes'],
  Playlist: ['playlists'],
  // Un statut renommé ou retiré touche toute la hiérarchie : elle est relue en entier,
  // mais sans les médias, qui n'ont pas pu changer.
  Status: ['statuses', 'sequences', 'shots', 'assets', 'tasks'],
  // Un compte modifié change les assignations : seules les tâches les portent.
  HumanUser: ['statuses', 'users', 'tasks'],
};

/**
 * Entités dont l'événement porte sur tout le projet plutôt que sur une ligne précise :
 * les cibler par identifiant n'aurait pas de sens (un statut n'est pas une entité de
 * production, il en qualifie des milliers).
 */
const GLOBAL_ENTITIES = new Set(['Status', 'HumanUser']);

/**
 * Entités que ReView sait traiter — le reste est ignoré sans bruit. La liste se déduit
 * de la table des passes : accepter un événement qu'aucune passe ne traite était
 * exactement le défaut des notes et des playlists.
 */
export const HANDLED_ENTITIES: ReadonlySet<string> = new Set(Object.keys(PASSES_BY_ENTITY));

export function passesForEvent(entity: string): readonly SyncPass[] | null {
  return PASSES_BY_ENTITY[entity] ?? null;
}

export function eventIsGlobal(entity: string): boolean {
  return GLOBAL_ENTITIES.has(entity);
}

/**
 * Passes déduites d'une demande ciblée qui ne les a pas nommées.
 *
 * Réaligner une carte de plan ou arbitrer un conflit de tâche passe `onlySgIds` sans rien
 * dire des passes : la demande balayait alors les notes, les playlists et les cinq mille
 * `PublishedFile` du projet pour une entité. Le type ciblé suffit à savoir quoi relire.
 * Un type inconnu ne se devine pas : on rend `undefined` et tout est exécuté.
 */
export function impliedPasses(
  onlySgIds: readonly { sgType: string; sgId: number }[] | undefined,
): SyncPass[] | undefined {
  if (!onlySgIds?.length) return undefined;
  const union = new Set<SyncPass>();
  for (const { sgType } of onlySgIds) {
    const passes = passesForEvent(sgType);
    if (!passes) return undefined;
    for (const pass of passes) union.add(pass);
  }
  return ALL_PASSES.filter((p) => union.has(p));
}

/**
 * Passes effectivement demandées.
 *
 * `passes` explicite l'emporte, puis la déduction depuis les entités ciblées, puis tout.
 * `withMedia: false` reste un veto : il retire versions, publishes, notes et playlists
 * quelle que soit la façon dont la liste a été obtenue — un appelant qui a dit « structure
 * seule » ne doit pas se retrouver à rapatrier des médias par déduction.
 */
export function resolvePasses(options: {
  passes?: readonly SyncPass[];
  onlySgIds?: readonly { sgType: string; sgId: number }[];
  withMedia?: boolean;
}): Set<SyncPass> {
  const list = options.passes ?? impliedPasses(options.onlySgIds) ?? ALL_PASSES;
  if (options.withMedia === false) return new Set(list.filter((p) => STRUCTURE_PASSES.includes(p)));
  return new Set(list);
}

/**
 * Fusion de deux demandes : l'union, et `undefined` (= tout) absorbe le reste.
 * Comme pour `onlySgIds`, on peut rattraper trop, jamais trop peu.
 */
export function mergePasses(
  a: readonly SyncPass[] | undefined,
  b: readonly SyncPass[] | undefined,
): SyncPass[] | undefined {
  if (!a || !b) return undefined;
  const union = new Set<SyncPass>([...a, ...b]);
  // Ordre canonique : la liste sert aussi de trace lisible dans le journal.
  return ALL_PASSES.filter((p) => union.has(p));
}

/** Identifiants distants d'un type donné dans une demande ciblée. */
export function sgIdsOfType(
  onlySgIds: readonly { sgType: string; sgId: number }[] | undefined,
  sgType: string,
): number[] {
  if (!onlySgIds?.length) return [];
  const ids = onlySgIds.filter((r) => r.sgType === sgType).map((r) => r.sgId);
  return [...new Set(ids)];
}
