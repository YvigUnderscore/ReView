// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

/**
 * A member's departments, against a real database (batch 10).
 *
 * Unit tests pin down the shape of the write; this one checks what cannot be mocked: that Postgres
 * really applies a `connect`/`disconnect` on the many-to-many relation, and above all that an edit
 * made from ONE project does not touch the departments the person holds elsewhere. That is the loss
 * that cannot be recovered: it would only show a week later, when someone's work disappears from the
 * filters.
 */
const app = createApp({ rateLimit: false });

let token = '';
let artistToken = '';
let artistId = 0;
let projectA = 0;
let projectB = 0;
/** Step specific to project A. */
let deptA = 0;
/** Step specific to project B, unrelated to project A. */
let deptB = 0;
/** Studio-wide step, inherited by both projects. */
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

/** The artist's departments across all projects: the truth in the database. */
const heldByArtist = async (): Promise<number[]> => {
  const user = await prisma.user.findUnique({
    where: { id: artistId },
    select: { departments: { select: { id: true } } },
  });
  return (user?.departments ?? []).map((d) => d.id).sort((x, y) => x - y);
};

describe('PATCH /api/projects/:id/members/:userId/departments', () => {
  it('adds a project step and shows it on the project sheet', async () => {
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

  it('accepts a studio reference step, inherited by the project', async () => {
    const r = await request(app)
      .patch(`/api/projects/${projectA}/members/${artistId}/departments`)
      .set(auth(token))
      .send({ add: [deptStudio] });
    expect(r.status).toBe(200);
    expect(await heldByArtist()).toEqual([deptA, deptStudio].sort((x, y) => x - y));
  });

  it('refuses the step of ANOTHER project, on addition as on removal', async () => {
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

  it('does not touch the steps the person holds on another project', async () => {
    // The scenario that justifies everything else: the artist holds a step of project B;
    // an edit made from project A must not drop it.
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

  it('bounds the project sheet to its own vocabulary', async () => {
    // The artist holds the project B step: it must not appear on project A.
    const project = await request(app).get(`/api/projects/${projectA}`).set(auth(token));
    const membership = project.body.project.memberships.find(
      (m: { user: { id: number } }) => m.user.id === artistId,
    );
    const ids = membership.user.departments.map((d: { id: number }) => d.id);
    expect(ids).not.toContain(deptB);
    expect(ids).toContain(deptStudio);
  });

  it('refuses a member who does not belong to the project', async () => {
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

  it('refuses an ordinary member: setting departments means managing the project', async () => {
    const r = await request(app)
      .patch(`/api/projects/${projectA}/members/${artistId}/departments`)
      .set(auth(artistToken))
      .send({ add: [deptA] });
    expect(r.status).toBe(403);
  });
});
