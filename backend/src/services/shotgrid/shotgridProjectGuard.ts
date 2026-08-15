// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { asEntityRef, type SgRecord } from './shotgridMapper';

/**
 * Garde-fou de cloisonnement des projets.
 *
 * Un site ShotGrid héberge tous les projets du studio. Une requête mal filtrée, un
 * identifiant réutilisé après suppression, un webhook mal configuré côté ShotGrid :
 * il suffit de peu pour lire — ou pire, écrire — dans le projet du voisin. Toute donnée
 * entrante passe donc par `belongsToProject`, et toute requête sortante par
 * `projectFilter`. La ceinture (filtre) et les bretelles (vérification) : le filtre
 * peut être oublié dans un appel, la vérification est le dernier rempart.
 *
 * Les entités hors projet (HumanUser, Status, Step) n'ont pas de champ `project` :
 * elles sont explicitement listées ici, plutôt que d'accepter toute entité sans projet.
 */

/** Entités globales d'un site, légitimement sans rattachement projet. */
export const PROJECT_LESS_ENTITIES = new Set([
  'HumanUser',
  'ApiUser',
  'Status',
  'Step',
  'PublishedFileType',
  'Department',
  'Group',
]);

export interface ProjectScope {
  sgProjectId: number;
  sgProjectName: string;
}

/** Filtre à joindre à toute recherche portant sur une entité de projet. */
export function projectFilter(sgProjectId: number): [string, string, { type: string; id: number }] {
  return ['project', 'is', { type: 'Project', id: sgProjectId }];
}

export type BelongsResult =
  { ok: true } | { ok: false; reason: 'wrong_project'; foundProjectId: number | null };

/**
 * L'entité appartient-elle bien au projet lié ? Une entité globale connue passe ;
 * une entité de projet sans champ `project` lisible est refusée (on ne devine pas).
 */
export function belongsToProject(record: SgRecord, scope: ProjectScope): BelongsResult {
  if (PROJECT_LESS_ENTITIES.has(record.type)) return { ok: true };
  // Le projet lui-même : c'est son propre identifiant qui doit correspondre.
  if (record.type === 'Project')
    return record.id === scope.sgProjectId
      ? { ok: true }
      : { ok: false, reason: 'wrong_project', foundProjectId: record.id };

  const ref = asEntityRef(record.project);
  if (!ref) return { ok: false, reason: 'wrong_project', foundProjectId: null };
  return ref.id === scope.sgProjectId
    ? { ok: true }
    : { ok: false, reason: 'wrong_project', foundProjectId: ref.id };
}

/**
 * Le projet distant est-il toujours celui qu'on croit ?
 *
 * Vérifié avant chaque synchronisation : si le nom ne correspond plus, on ne sait pas
 * si le projet a simplement été renommé ou si l'identifiant désigne désormais autre
 * chose. Dans le doute on s'arrête — écrire dans le mauvais projet ne se rattrape pas.
 * La comparaison ignore la casse et les espaces de bord, pas le reste.
 */
export function projectNameMatches(remoteName: string | null | undefined, expected: string): boolean {
  if (typeof remoteName !== 'string') return false;
  return remoteName.trim().toLocaleLowerCase() === expected.trim().toLocaleLowerCase();
}

/** Événement de webhook : concerne-t-il bien le projet de cette connexion ? */
export function eventBelongsToProject(
  payload: { project?: unknown; entity?: unknown },
  scope: ProjectScope,
): boolean {
  const ref = asEntityRef(payload.project);
  if (ref) return ref.id === scope.sgProjectId;
  // Sans projet dans l'enveloppe, l'entité est peut-être globale (Status, HumanUser).
  const entity = asEntityRef(payload.entity);
  return entity !== null && PROJECT_LESS_ENTITIES.has(entity.type);
}
