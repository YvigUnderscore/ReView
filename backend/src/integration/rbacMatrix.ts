// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Actor, RbacFixture } from './rbacFixture';

/**
 * Matrice d'autorisation — table déclarative `[méthode, chemin, rôle, attendu]`.
 *
 * Ce fichier est fait pour grossir. Ajouter un endpoint = ajouter une ligne ; le moteur
 * (`rbac-matrix.itest.ts`) se charge du reste, y compris de rejouer chaque ligne sans jeton
 * pour exiger un 401. Trois règles pour que la table reste lisible :
 *
 *  1. **`allow` ne dit pas « 200 »**, il dit « le garde a laissé passer » (< 400). C'est
 *     tout ce qu'un test d'autorisation doit affirmer ; le reste appartient aux tests
 *     fonctionnels.
 *  2. **`deny` dit exactement 403.** Un 404 « poli » à la place d'un 403 serait une autre
 *     décision — défendable, mais elle doit s'écrire ici, pas se découvrir.
 *  3. **Une ligne qui écrit doit être rejouable.** Les cas mutants retenus sont
 *     idempotents (ajout de membre = upsert, écriture de board vide) ; sinon, ne déclarer
 *     que le côté refusé et laisser les acteurs autorisés hors de la ligne.
 */

/** Verdict attendu du garde, indépendamment de ce que fait ensuite le handler. */
export type Outcome = 'allow' | 'deny';

export interface MatrixCase {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Chemin avec substitutions `{projectA}`, `{shotB}`, `{userArtist}`… (cf. `substitute`). */
  path: string;
  /** Corps envoyé tel quel ; les substitutions s'appliquent aussi aux valeurs numériques. */
  body?: Record<string, unknown>;
  /** Rappel du garde couvert — sert de message d'échec, donc écrit pour être lu. */
  guard: string;
  /**
   * Verdict attendu par acteur. **Un acteur absent n'est pas joué** : c'est ainsi qu'on
   * laisse hors d'atteinte les combinaisons destructrices (purge d'un projet par l'admin).
   */
  expect: Partial<Record<Exclude<Actor, 'anon'>, Outcome>>;
  /** Endpoint public : ne pas exiger 401 de l'anonyme. */
  public?: boolean;
}

/** Toutes les substitutions reconnues dans un chemin ou un corps. */
export function placeholders(f: RbacFixture): Record<string, number> {
  return {
    projectA: f.projectA,
    projectB: f.projectB,
    shotA: f.shotA,
    shotB: f.shotB,
    taskB: f.taskB,
    versionB: f.versionB,
    userArtist: f.userIds.artist,
    userClient: f.userIds.client,
    userOutsider: f.userIds.outsider,
  };
}

export function substitute(path: string, values: Record<string, number>): string {
  return path.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Unknown placeholder {${key}} in "${path}"`);
    return String(value);
  });
}

/** Même substitution dans un corps JSON : `{ userId: '{userArtist}' }` → `{ userId: 42 }`. */
export function substituteBody(
  body: Record<string, unknown> | undefined,
  values: Record<string, number>,
): Record<string, unknown> | undefined {
  if (!body) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] =
      typeof value === 'string' && /^\{\w+\}$/.test(value) ? Number(substitute(value, values)) : value;
  }
  return out;
}

const EMPTY_BOARD = { document: { elements: [], files: {} }, baseUpdatedAt: null };

/**
 * La table.
 *
 * Elle couvre les quatre familles de gardes du backend : `requireRole` (global),
 * `requireProjectAccess` / `assertProjectAccess` (appartenance), `requireProjectManage`
 * (élévation locale, décision 38.E) et les refus propres au rôle CLIENT.
 */
export const AUTHORIZATION_MATRIX: MatrixCase[] = [
  // ── requireProjectAccess : appartenance au projet ────────────────────────────
  {
    method: 'get',
    path: '/api/projects/{projectA}',
    guard: 'requireProjectAccess',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'allow', client: 'allow', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/projects/{projectB}',
    guard: 'requireProjectAccess (projet disjoint)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/projects/{projectB}/settings',
    guard: 'requireProjectAccess',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/projects/{projectB}/activity',
    guard: 'requireProjectAccess',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },

  // ── assertProjectAccess : le même contrôle, mais dans le handler ─────────────
  {
    method: 'get',
    path: '/api/shots?projectId={projectA}',
    guard: 'assertProjectAccess (liste)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'allow', client: 'allow', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/shots?projectId={projectB}',
    guard: 'assertProjectAccess (liste, projet disjoint)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/sequences?projectId={projectB}',
    guard: 'assertProjectAccess (liste)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/assets?projectId={projectB}',
    guard: 'assertProjectAccess (liste)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/tasks?projectId={projectB}',
    guard: 'assertProjectAccess (liste)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  // Accès par identifiant : le projet n'est pas dans l'URL, il est résolu depuis l'entité.
  // C'est exactement la forme d'IDOR qu'aucun test à Prisma doublé ne peut voir.
  {
    method: 'get',
    path: '/api/shots/{shotB}',
    guard: 'assertProjectAccess (par id, IDOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/shots/{shotB}/tree',
    guard: 'assertProjectAccess (par id, IDOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/tasks/{taskB}',
    guard: 'assertProjectAccess (par id, IDOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },
  {
    method: 'get',
    path: '/api/versions/{versionB}',
    guard: 'assertProjectAccess (par id, IDOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'allow' },
  },

  // ── requireRole : privilèges globaux ─────────────────────────────────────────
  {
    method: 'get',
    path: '/api/users',
    guard: 'requireRole(ADMIN, SUPERVISOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/projects/{projectA}/trash',
    guard: 'requireRole(ADMIN, SUPERVISOR)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/studio/settings',
    guard: 'requireRole(ADMIN)',
    expect: { admin: 'allow', supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/studio/audit',
    guard: 'requireRole(ADMIN)',
    expect: { admin: 'allow', supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/admin/webhooks',
    guard: 'requireRole(ADMIN)',
    expect: { admin: 'allow', supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'get',
    path: '/api/admin/service-tokens',
    guard: 'requireRole(ADMIN)',
    expect: { admin: 'allow', supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  // Écritures : seul le côté refusé est joué — créer un projet ou un compte à chaque
  // exécution polluerait le décor de la matrice elle-même.
  {
    method: 'post',
    path: '/api/projects',
    body: { name: 'RBAC forbidden' },
    guard: 'requireRole(ADMIN, SUPERVISOR)',
    expect: { artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  {
    method: 'post',
    path: '/api/users',
    body: { email: 'rbac-forbidden@review.local', role: 'ARTIST' },
    guard: 'requireRole(ADMIN)',
    expect: { supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },
  // Purge : destructrice. L'admin n'est délibérément pas joué.
  {
    method: 'delete',
    path: '/api/projects/{projectB}/purge',
    guard: 'requireRole(ADMIN)',
    expect: { supervisor: 'deny', artist: 'deny', client: 'deny', outsider: 'deny' },
  },

  // ── requireProjectManage : gestion du projet (38.E) ──────────────────────────
  // Idempotent : `addMember` est un upsert, et l'artiste est déjà membre du projet A.
  {
    method: 'post',
    path: '/api/projects/{projectA}/members',
    body: { userId: '{userArtist}' },
    guard: 'requireProjectManage',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'deny', client: 'deny', outsider: 'deny' },
  },

  // ── Rôle CLIENT : membre du projet, mais jamais contributeur ─────────────────
  {
    method: 'get',
    path: '/api/boards/project/{projectA}',
    guard: 'assertProjectAccess (lecture board)',
    expect: { admin: 'allow', supervisor: 'allow', artist: 'allow', client: 'allow', outsider: 'deny' },
  },
  {
    method: 'put',
    path: '/api/boards/project/{projectA}',
    body: EMPTY_BOARD,
    guard: 'board en écriture : lecture seule pour un CLIENT',
    expect: { client: 'deny', outsider: 'deny' },
  },
];
