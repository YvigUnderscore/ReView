// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

/**
 * Integration tests for the v1 API (require Postgres/Redis/MinIO).
 *
 * They verify what sets this API apart: path addressing, idempotent creation, scoping a token to
 * a project, and two-call publishing. No bytes are uploaded to storage: publishing stops at the
 * presigned URL, which is enough to validate the server-side chain.
 */
const app = createApp({ rateLimit: false });

let adminToken = '';
let projectCode = '';
const suffix = Date.now().toString(36);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const status = await request(app).get('/api/setup/status');
  if (status.body.needsSetup) {
    const r = await request(app).post('/api/setup').send({
      studioName: 'IT Studio',
      adminEmail: 'it-admin@review.local',
      adminPassword: 'admin1234',
      adminName: 'IT Admin',
    });
    adminToken = r.body.token;
  } else {
    for (const email of ['admin@review.local', 'it-admin@review.local', 'ci-admin@review.local']) {
      const r = await request(app).post('/api/auth/login').send({ email, password: 'admin1234' });
      if (r.status === 200) {
        adminToken = r.body.token;
        break;
      }
    }
  }

  const project = await request(app)
    .post('/api/projects')
    .set(auth(adminToken))
    .send({ name: `V1 Pipeline ${suffix}` });
  projectCode = project.body.project.slug;
});

describe('v1 — discovery', () => {
  it('exposes its index without prior authentication of the content', async () => {
    const r = await request(app).get('/api/v1').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.version).toBe('v1');
    expect(r.body.capabilities.pathResolution).toBe(true);
  });

  it('refuses an unauthenticated call', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
  });

  it('describes the powers of the bearer', async () => {
    const r = await request(app).get('/api/v1/me').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.auth.kind).toBe('session');
    expect(r.body.projects).toBe('all');
  });

  it('publishes the enumerations and the event catalogue', async () => {
    const r = await request(app).get('/api/v1/schema').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.enums.taskStatus).toContain('IN_PROGRESS');
    expect(r.body.events).toContain('version.published');
    expect(r.body.scopes).toContain('versions:write');
  });
});

describe('v1 — idempotent creation and resolution by path', () => {
  it('creates the hierarchy then finds it again without duplicates', async () => {
    const seq = await request(app)
      .post(`/api/v1/projects/${projectCode}/sequences`)
      .set(auth(adminToken))
      .send({ code: 'SQ010' });
    expect(seq.status).toBe(201);
    expect(seq.body.created).toBe(true);

    // Replay: same call, no creation, status 200 instead of 201.
    const again = await request(app)
      .post(`/api/v1/projects/${projectCode}/sequences`)
      .set(auth(adminToken))
      .send({ code: 'SQ010' });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.sequence.id).toBe(seq.body.sequence.id);

    const shot = await request(app)
      .post(`/api/v1/projects/${projectCode}/shots`)
      .set(auth(adminToken))
      .send({ code: 'SH0100', sequenceCode: 'SQ010', startFrame: 1001, endFrame: 1096 });
    expect(shot.status).toBe(201);
    expect(shot.body.shot.path).toBe(`${projectCode}/SQ010/SH0100`);

    const task = await request(app)
      .post(`/api/v1/shots/${shot.body.shot.id}/tasks`)
      .set(auth(adminToken))
      .send({ name: 'anim' });
    expect(task.status).toBe(201);
    // The type is inferred from the name when not provided.
    expect(task.body.task.type).toBe('ANIMATION');
  });

  it('resolves a full path into entities', async () => {
    const r = await request(app)
      .get('/api/v1/resolve')
      .query({ path: `${projectCode}/SQ010/SH0100/anim` })
      .set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('task');
    expect(r.body.shot.code).toBe('SH0100');
    expect(r.body.task.name).toBe('anim');
  });

  it('resolves regardless of case', async () => {
    const r = await request(app)
      .get('/api/v1/resolve')
      .query({ path: `${projectCode}/sq010/sh0100` })
      .set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.shot.code).toBe('SH0100');
  });

  it('names the segment that was not found', async () => {
    const r = await request(app)
      .get('/api/v1/resolve')
      .query({ path: `${projectCode}/SQ010/SH9999` })
      .set(auth(adminToken));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('SHOT_NOT_FOUND');
  });
});

describe('v1 — publishing from a DCC', () => {
  // These cases stop before the file upload: the media stay in UPLOADING and hit the concurrent
  // upload ceiling (5). Start from a clean slate.
  beforeEach(async () => {
    await prisma.mediaObject.deleteMany({ where: { status: 'UPLOADING' } });
  });

  it('opens a publication and returns an upload URL', async () => {
    const r = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .send({
        path: `${projectCode}/SQ010/SH0100/anim`,
        filename: 'SH0100_anim_v001.mov',
        size: 1024,
      });
    expect(r.status).toBe(201);
    expect(r.body.uploadUrl).toMatch(/^https?:\/\//);
    expect(r.body.uploadMethod).toBe('PUT');
    expect(r.body.version.name).toBe('V01');
    expect(r.body.versionCreated).toBe(true);
  });

  it('numbers the next version without overwriting the previous one', async () => {
    const r = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .send({ path: `${projectCode}/SQ010/SH0100/anim`, filename: 'SH0100_anim_v002.mov' });
    expect(r.status).toBe(201);
    expect(r.body.version.name).toBe('V02');
  });

  it('creates the missing links of the path at once', async () => {
    const r = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .send({
        path: `${projectCode}/SQ020/SH0200/lighting`,
        filename: 'render.exr',
        shot: { startFrame: 1001, endFrame: 1050 },
      });
    expect(r.status).toBe(201);
    expect(r.body.created).toEqual(expect.arrayContaining(['sequence', 'shot', 'task']));
  });

  it('refuses a path too short to designate a target', async () => {
    const r = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .send({ path: projectCode, filename: 'x.mov' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PATH_TOO_SHALLOW');
  });

  it('refuses a file whose type cannot be determined', async () => {
    const r = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .send({ path: `${projectCode}/SQ010/SH0100/anim`, filename: 'notes.txt' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('KIND_UNKNOWN');
  });

  it('replays a request carrying the same idempotency key without recreating anything', async () => {
    const key = `it-${suffix}-idem`;
    const body = {
      path: `${projectCode}/SQ010/SH0100/anim`,
      filename: 'idem.mov',
      versionName: `IDEM${suffix}`,
    };
    const first = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .set('Idempotency-Key', key)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.mediaId).toBe(first.body.mediaId);

    // Without the key, the same call collides with the version that already exists.
    const conflict = await request(app).post('/api/v1/publish').set(auth(adminToken)).send(body);
    expect(conflict.status).toBe(400);
    expect(conflict.body.code).toBe('VERSION_EXISTS');
  });
});

describe('v1 — API tokens and scopes', () => {
  it('restricts a service token to its project and its scopes', async () => {
    const project = await prisma.project.findFirst({ where: { slug: projectCode } });
    const other = await request(app)
      .post('/api/projects')
      .set(auth(adminToken))
      .send({ name: `V1 Autre ${suffix}` });

    // Deliberate SUPERVISOR role: its access to projects is global, so only the token's scoping can
    // block the other project. That is what is tested.
    const created = await request(app)
      .post('/api/admin/service-tokens')
      .set(auth(adminToken))
      .send({
        name: `Ferme ${suffix}`,
        scopes: ['projects:read', 'shots:read'],
        role: 'SUPERVISOR',
        projectId: project!.id,
        // Re-authentication required since wave 3: a stolen access token must not be enough to forge
        // a durable machine identity.
        currentPassword: 'admin1234',
      });
    expect(created.status).toBe(201);
    const token: string = created.body.token;
    expect(token.startsWith('rvk_')).toBe(true);

    // The granted scope works...
    const shots = await request(app).get(`/api/v1/projects/${projectCode}/shots`).set(auth(token));
    expect(shots.status).toBe(200);

    // ...the one that is not granted is refused, with the missing scope named.
    const versions = await request(app).get(`/api/v1/projects/${projectCode}/versions`).set(auth(token));
    expect(versions.status).toBe(403);
    expect(versions.body.code).toBe('SCOPE_REQUIRED');

    // Scoping takes precedence over everything: the other project stays out of reach.
    const foreign = await request(app).get(`/api/v1/projects/${other.body.project.slug}`).set(auth(token));
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('TOKEN_PROJECT_SCOPE');

    // The project list is reduced to the token's own project only.
    const list = await request(app).get('/api/v1/projects').set(auth(token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].code).toBe(projectCode);
  });

  it('does not expose service accounts in the directory', async () => {
    const users = await request(app).get('/api/users').set(auth(adminToken));
    expect(users.status).toBe(200);
    const emails: string[] = users.body.users.map((u: { email: string }) => u.email);
    expect(emails.some((e) => e.includes('service.review.invalid'))).toBe(false);
  });

  it('forbids interactive login of a service account', async () => {
    const svc = await prisma.user.findFirst({ where: { isService: true } });
    expect(svc).not.toBeNull();
    const r = await request(app).post('/api/auth/login').send({ email: svc!.email, password: 'admin1234' });
    expect(r.status).toBe(401);
  });
});

describe('v1 — event log', () => {
  it('starts at the present then delivers the following events', async () => {
    const first = await request(app).get('/api/v1/events').set(auth(adminToken));
    expect(first.status).toBe(200);
    expect(first.body.events).toEqual([]);
    const cursor: number = first.body.cursor;

    // A business event feeds the log.
    const shot = await request(app)
      .post(`/api/v1/projects/${projectCode}/shots`)
      .set(auth(adminToken))
      .send({ code: `SH${suffix.slice(-4)}` });
    await request(app)
      .post(`/api/v1/shots/${shot.body.shot.id}/tasks`)
      .set(auth(adminToken))
      .send({ name: 'comp' });

    // Logging is asynchronous: give the write time to complete.
    await new Promise((r) => setTimeout(r, 500));

    const next = await request(app).get('/api/v1/events').query({ since: cursor }).set(auth(adminToken));
    expect(next.status).toBe(200);
    expect(next.body.events.length).toBeGreaterThan(0);
    expect(next.body.events.map((e: { event: string }) => e.event)).toContain('task.created');
    expect(next.body.cursor).toBeGreaterThan(cursor);
  });
});
