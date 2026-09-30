// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import request from 'supertest';
import type { Express } from 'express';

/**
 * Décor de la matrice d'autorisation : quatre rôles, deux projets disjoints.
 *
 * Deux projets — et non un — parce que la faute que ce dispositif doit attraper n'est pas
 * « le rôle X passe une porte réservée » (les tests de service à Prisma doublé la voient),
 * c'est « la requête a oublié son `projectId` » : un membre du projet A qui lit une entité
 * du projet B. Il faut donc un B, et quelqu'un qui n'y est pas.
 *
 * Les comptes portent un suffixe d'exécution : la base d'intégration est jetable, mais le
 * décor doit aussi pouvoir se reconstruire sur une base déjà peuplée.
 */

/** Les six voix jouées contre chaque endpoint. */
export type Actor = 'anon' | 'admin' | 'supervisor' | 'artist' | 'client' | 'outsider';

/** Les cinq voix authentifiées — `anon` est joué à part, contre toute la table. */
export const AUTHENTICATED_ACTORS: Exclude<Actor, 'anon'>[] = [
  'admin',
  'supervisor',
  'artist',
  'client',
  'outsider',
];

export interface RbacFixture {
  /** Jeton par acteur ; `anon` n'en a pas. */
  tokens: Record<Exclude<Actor, 'anon'>, string>;
  /** Identifiants des comptes, pour les corps de requête (ajout de membre…). */
  userIds: Record<Exclude<Actor, 'anon'>, number>;
  /** Projet A : `artist` et `client` en sont membres, `outsider` non. */
  projectA: number;
  /** Projet B : seul `outsider` en est membre. */
  projectB: number;
  shotA: number;
  shotB: number;
  taskB: number;
  versionB: number;
}

const ADMIN_PASSWORD = 'admin1234';
const PASSWORD = 'matrix1234';

async function loginAdmin(app: Express): Promise<string> {
  const status = await request(app).get('/api/setup/status');
  if (status.body.needsSetup) {
    const created = await request(app).post('/api/setup').send({
      studioName: 'CI Studio',
      adminEmail: 'ci-admin@review.local',
      adminPassword: ADMIN_PASSWORD,
      adminName: 'CI',
    });
    return created.body.token as string;
  }
  for (const email of ['admin@review.local', 'ci-admin@review.local']) {
    const r = await request(app).post('/api/auth/login').send({ email, password: ADMIN_PASSWORD });
    if (r.status === 200) return r.body.token as string;
  }
  throw new Error('No administrator account available for the authorization matrix.');
}

/** Crée un compte du rôle demandé et rend son id et son jeton. */
async function makeUser(
  app: Express,
  adminToken: string,
  role: 'SUPERVISOR' | 'ARTIST' | 'CLIENT',
  label: string,
  suffix: string,
): Promise<{ id: number; token: string }> {
  const email = `rbac-${label}-${suffix}@review.local`;
  const created = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email, password: PASSWORD, name: `RBAC ${label}`, role });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`Cannot create the ${role} account: HTTP ${created.status}`);
  }
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  if (login.status !== 200) throw new Error(`Cannot sign in as ${role}: HTTP ${login.status}`);
  return { id: created.body.user.id as number, token: login.body.token as string };
}

export async function buildRbacFixture(app: Express): Promise<RbacFixture> {
  const suffix = String(Date.now());
  const adminToken = await loginAdmin(app);
  const auth = { Authorization: `Bearer ${adminToken}` };

  const adminMe = await request(app).get('/api/auth/me').set(auth);

  const supervisor = await makeUser(app, adminToken, 'SUPERVISOR', 'supervisor', suffix);
  const artist = await makeUser(app, adminToken, 'ARTIST', 'artist', suffix);
  const client = await makeUser(app, adminToken, 'CLIENT', 'client', suffix);
  const outsider = await makeUser(app, adminToken, 'ARTIST', 'outsider', suffix);

  const makeProject = async (name: string): Promise<number> => {
    const r = await request(app).post('/api/projects').set(auth).send({ name });
    if (r.status !== 201) throw new Error(`Cannot create project ${name}: HTTP ${r.status}`);
    return r.body.project.id as number;
  };
  const projectA = await makeProject(`RBAC A ${suffix}`);
  const projectB = await makeProject(`RBAC B ${suffix}`);

  const addMember = async (projectId: number, userId: number): Promise<void> => {
    const r = await request(app).post(`/api/projects/${projectId}/members`).set(auth).send({ userId });
    if (r.status !== 201) throw new Error(`Cannot add member ${userId}: HTTP ${r.status}`);
  };
  await addMember(projectA, artist.id);
  await addMember(projectA, client.id);
  await addMember(projectB, outsider.id);

  const makeShot = async (projectId: number, code: string): Promise<number> => {
    const r = await request(app).post('/api/shots').set(auth).send({ projectId, name: code, code });
    if (r.status !== 201) throw new Error(`Cannot create shot ${code}: HTTP ${r.status}`);
    return r.body.shot.id as number;
  };
  const shotA = await makeShot(projectA, `RBACA${suffix}`);
  const shotB = await makeShot(projectB, `RBACB${suffix}`);

  const taskCreated = await request(app)
    .post('/api/tasks')
    .set(auth)
    .send({ shotId: shotB, name: 'Matrix', type: 'OTHER' });
  const taskB = taskCreated.body.task.id as number;
  const versionCreated = await request(app).post('/api/versions').set(auth).send({ taskId: taskB });
  const versionB = versionCreated.body.version.id as number;

  return {
    tokens: {
      admin: adminToken,
      supervisor: supervisor.token,
      artist: artist.token,
      client: client.token,
      outsider: outsider.token,
    },
    userIds: {
      admin: adminMe.body.user.id as number,
      supervisor: supervisor.id,
      artist: artist.id,
      client: client.id,
      outsider: outsider.id,
    },
    projectA,
    projectB,
    shotA,
    shotB,
    taskB,
    versionB,
  };
}
