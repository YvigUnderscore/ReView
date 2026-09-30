// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

/**
 * Départements d'un membre, contre une vraie base (lot 10).
 *
 * Les tests unitaires figent la forme de l'écriture ; celui-ci vérifie ce qui ne se
 * bouchonne pas : que Postgres applique bien un `connect`/`disconnect` sur la relation
 * multiple, et surtout que l'édition faite depuis UN projet ne touche pas aux départements
 * que la personne tient ailleurs. C'est la perte qu'on ne rattrape pas — elle ne se verrait
 * qu'une semaine plus tard, quand le travail de quelqu'un disparaît des filtres.
 */
const app = createApp({ rateLimit: false });

let token = '';
let artistToken = '';
let artistId = 0;
let projectA = 0;
let projectB = 0;
/** Étape propre au projet A. */
let deptA = 0;
/** Étape propre au projet B — étrangère au projet A. */
let deptB = 0;
/** Étape du référentiel studio, héritée par les deux projets. */
let deptStudio = 0;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  const status = await request(app).get('/api/setup/status');
  if (status.body.needsSetup) {
    const r = await request(app).post('/api/setup').send({
      studioName: 'CI Studio',
      adminEmail: 'ci-admin@review.local',
      adminPassword: 'admin1234',
      adminName: 'CI',
    });
    token = r.body.token;
  } else {
    for (const email of ['admin@review.local', 'ci-admin@review.local']) {
      const r = await request(app).post('/api/auth/login').send({ email, password: 'admin1234' });
      if (r.status === 200) {
        token = r.body.token;
        break;
      }
    }
  }

  const suffix = Date.now();
  const a = await request(app)
    .post('/api/projects')
    .set(auth(token))
    .send({ name: `Dept A ${suffix}` });
  projectA = a.body.project.id;
  const b = await request(app)
    .post('/api/projects')
    .set(auth(token))
    .send({ name: `Dept B ${suffix}` });
  projectB = b.body.project.id;

  const studio = await request(app)
    .post('/api/departments')
    .set(auth(token))
    .send({ name: `Studio Step ${suffix}` });
  deptStudio = studio.body.department.id;
  const own = await request(app)
    .post(`/api/projects/${projectA}/departments`)
    .set(auth(token))
    .send({ name: `A Step ${suffix}` });
  deptA = own.body.department.id;
  const other = await request(app)
    .post(`/api/projects/${projectB}/departments`)
    .set(auth(token))
    .send({ name: `B Step ${suffix}` });
  deptB = other.body.department.id;

  const email = `it-dept-artist-${suffix}@review.local`;
  const created = await request(app)
    .post('/api/users')
    .set(auth(token))
    .send({ email, password: 'artist1234', name: 'IT Dept Artist', role: 'ARTIST' });
  artistId = created.body.user.id;
  artistToken = (await request(app).post('/api/auth/login').send({ email, password: 'artist1234' })).body
    .token;

  await request(app).post(`/api/projects/${projectA}/members`).set(auth(token)).send({ userId: artistId });
  await request(app).post(`/api/projects/${projectB}/members`).set(auth(token)).send({ userId: artistId });
});

afterAll(async () => {
  if (artistId) await prisma.user.deleteMany({ where: { id: artistId } });
  const ids = [projectA, projectB].filter(Boolean);
  if (ids.length) await prisma.project.deleteMany({ where: { id: { in: ids } } });
  if (deptStudio) await prisma.department.deleteMany({ where: { id: deptStudio } });
});

/** Les départements de l'artiste, tous projets confondus — la vérité en base. */
const heldByArtist = async (): Promise<number[]> => {
  const user = await prisma.user.findUnique({
    where: { id: artistId },
    select: { departments: { select: { id: true } } },
  });
  return (user?.departments ?? []).map((d) => d.id).sort((x, y) => x - y);
};

describe('PATCH /api/projects/:id/members/:userId/departments', () => {
  it('ajoute une étape du projet et la rend sur la fiche du projet', async () => {
    const r = await request(app)
      .patch(`/api/projects/${projectA}/members/${artistId}/departments`)
      .set(auth(token))
      .send({ add: [deptA] });
    expect(r.status).toBe(200);
    expect(r.body.departments.map((d: { id: number }) => d.id)).toContain(deptA);

    const project = await request(app).get(`/api/projects/${projectA}`).set(auth(token));
    const membership = project.body.project.memberships.find(
      (m: { user: { id: number } }) => m.user.id === artistId,
    );
    expect(membership.user.departments.map((d: { id: number }) => d.id)).toContain(deptA);
  });

  it('accepte une étape du référentiel studio, héritée par le projet', async () => {
    const r = await request(app)
      .patch(`/api/projects/${projectA}/members/${artistId}/departments`)
      .set(auth(token))
      .send({ add: [deptStudio] });
    expect(r.status).toBe(200);
    expect(await heldByArtist()).toEqual([deptA, deptStudio].sort((x, y) => x - y));
  });

  it('refuse l’étape d’un AUTRE projet, à l’ajout comme au retrait', async () => {
    const add = await request(app)
      .patch(`/api/projects/${projectA}/members/${artistId}/departments`)
      .set(auth(token))
      .send({ add: [deptB] });
    expect(add.status).toBe(400);

    const remove = await request(app)
      .patch(`/api/projects/${projectA}/members/${artistId}/departments`)
      .set(auth(token))
      .send({ remove: [deptB] });
    expect(remove.status).toBe(400);
  });

  it('ne touche pas aux étapes que la personne tient sur un autre projet', async () => {
    // Le scénario qui justifie tout le reste : l'artiste porte une étape du projet B ;
    // une édition faite depuis le projet A ne doit pas l'emporter.
    await request(app)
      .patch(`/api/projects/${projectB}/members/${artistId}/departments`)
      .set(auth(token))
      .send({ add: [deptB] });
    expect(await heldByArtist()).toContain(deptB);

    await request(app)
      .patch(`/api/projects/${projectA}/members/${artistId}/departments`)
      .set(auth(token))
      .send({ remove: [deptA] });

    const held = await heldByArtist();
    expect(held).toContain(deptB);
    expect(held).toContain(deptStudio);
    expect(held).not.toContain(deptA);
  });

  it('borne la fiche du projet à son propre vocabulaire', async () => {
    // L'artiste porte l'étape du projet B : elle ne doit pas apparaître sur le projet A.
    const project = await request(app).get(`/api/projects/${projectA}`).set(auth(token));
    const membership = project.body.project.memberships.find(
      (m: { user: { id: number } }) => m.user.id === artistId,
    );
    const ids = membership.user.departments.map((d: { id: number }) => d.id);
    expect(ids).not.toContain(deptB);
    expect(ids).toContain(deptStudio);
  });

  it('refuse un membre qui n’appartient pas au projet', async () => {
    const stranger = await prisma.user.findFirst({
      where: { memberships: { none: { projectId: projectA } }, isService: false },
      select: { id: true },
    });
    if (!stranger) return;
    const r = await request(app)
      .patch(`/api/projects/${projectA}/members/${stranger.id}/departments`)
      .set(auth(token))
      .send({ add: [deptA] });
    expect(r.status).toBe(404);
  });

  it('refuse un membre ordinaire : régler les départements, c’est gérer le projet', async () => {
    const r = await request(app)
      .patch(`/api/projects/${projectA}/members/${artistId}/departments`)
      .set(auth(artistToken))
      .send({ add: [deptA] });
    expect(r.status).toBe(403);
  });
});
