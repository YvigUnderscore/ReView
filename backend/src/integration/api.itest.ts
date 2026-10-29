// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { MediaStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from '../services/StorageService';
import { MAX_PAGE_SIZE } from '../lib/pagination';

/**
 * API integration tests (require Postgres/Redis/MinIO).
 *
 * The database is throwaway and reset before each run (`globalSetup`): this file runs the
 * studio's initial setup in it. It is still written so that it works on an already populated
 * database, which is what allows replaying it without a reset while debugging.
 */
const app = createApp({ rateLimit: false });
let token = '';
let artistToken = '';
let artistId = 0;

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

  // Creates an artist dedicated to the run (unique email) for the RBAC tests
  const email = `it-artist-${Date.now()}@review.local`;
  const created = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ email, password: 'artist1234', name: 'IT Artist', role: 'ARTIST' });
  artistId = created.body.user?.id ?? 0;
  const login = await request(app).post('/api/auth/login').send({ email, password: 'artist1234' });
  artistToken = login.body.token;
});

// The database is discarded between runs, but a test file remains responsible for what it creates:
// without this, replaying the suite twice without a reset (debugging) would accumulate one orphan
// ARTIST per run, the original defect.
afterAll(async () => {
  if (artistId) await prisma.user.deleteMany({ where: { id: artistId } });
});

describe('API — health & setup', () => {
  it('GET /health → 200', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });
  it('GET /api/setup/status → boolean', async () => {
    const r = await request(app).get('/api/setup/status');
    expect(r.status).toBe(200);
    expect(typeof r.body.needsSetup).toBe('boolean');
  });
});

describe('API — auth & RBAC', () => {
  it('an admin token is available', () => {
    expect(token).toBeTruthy();
  });
  it('GET /api/projects without token → 401', async () => {
    const r = await request(app).get('/api/projects');
    expect(r.status).toBe(401);
  });
  it('GET /api/projects with token → 200 + array', async () => {
    const r = await request(app).get('/api/projects').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    expect(typeof r.body.total).toBe('number');
  });
  it('GET /api/projects paginated → bounded envelope { items, total, page, pageSize }', async () => {
    // At least two projects, to check the bounding.
    await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Pag A ${Date.now()}` });
    await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Pag B ${Date.now()}` });
    const r = await request(app)
      .get('/api/projects?page=1&pageSize=1')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.page).toBe(1);
    expect(r.body.pageSize).toBe(1);
    expect(r.body.items.length).toBeLessThanOrEqual(1);
    expect(r.body.total).toBeGreaterThanOrEqual(2);
    // The hard ceiling is MAX_PAGE_SIZE (500): it is servable, beyond it Zod refuses (400).
    // Default and ceiling have not been conflated since pagination really exists.
    const ceiling = await request(app)
      .get(`/api/projects?pageSize=${MAX_PAGE_SIZE}`)
      .set('Authorization', `Bearer ${token}`);
    expect(ceiling.status).toBe(200);
    expect(ceiling.body.pageSize).toBe(MAX_PAGE_SIZE);
    const bad = await request(app)
      .get(`/api/projects?pageSize=${MAX_PAGE_SIZE + 1}`)
      .set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(400);
  });
  it('GET /api/auth/me → current user', async () => {
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('ADMIN');
  });

  it('revocable sessions (36.B): login → list → logout → dead token', async () => {
    // New dedicated login (same candidate accounts as the beforeAll) → clean session.
    let t = '';
    for (const email of ['admin@review.local', 'ci-admin@review.local']) {
      const r = await request(app).post('/api/auth/login').send({ email, password: 'admin1234' });
      if (r.status === 200) {
        t = r.body.token;
        break;
      }
    }
    expect(t).toBeTruthy();
    const sessions = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${t}`);
    expect(sessions.status).toBe(200);
    expect(sessions.body.sessions.some((s: { current: boolean }) => s.current)).toBe(true);

    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${t}`);
    expect(out.status).toBe(204);
    // Revocation also invalidates the access token (cache short-circuited by revokeSession).
    const after = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${t}`);
    expect(after.status).toBe(401);
  });

  it("API tokens (36.C): read scope → GET ok, write 403; immediate revocation", async () => {
    // Creating a `rvk_` requires re-entering the password: a stolen access token is not enough
    // to grant itself a 3650-day access that "log out everywhere" ignores.
    const noPassword = await request(app)
      .post('/api/auth/tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'IT no password', scopes: ['read'] });
    expect(noPassword.status).toBe(401);
    expect(noPassword.body.code).toBe('CURRENT_PASSWORD_REQUIRED');

    const created = await request(app)
      .post('/api/auth/tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'IT read', scopes: ['read'], currentPassword: 'admin1234' });
    expect(created.status).toBe(201);
    const apiTok = created.body.token as string;
    expect(apiTok).toMatch(/^rvk_/);

    // This scenario dates from phase 36, when a `rvk_` opened all of `/api`. Since then,
    // `apiTokenSurface` restricts it to `/api/v1` (no more `/api/docs` and `/api/openapi.json`):
    // a stolen token no longer reaches the application surface. The test therefore checks the
    // rule now in force, on both sides of the boundary.
    const offSurface = await request(app).get('/api/projects').set('Authorization', `Bearer ${apiTok}`);
    expect(offSurface.status).toBe(403);
    expect(offSurface.body.code).toBe('API_TOKEN_V1_ONLY');

    const read = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${apiTok}`);
    expect(read.status).toBe(200);
    const write = await request(app)
      .post('/api/v1/projects/any/sequences')
      .set('Authorization', `Bearer ${apiTok}`)
      .send({ code: 'refusé' });
    expect(write.status).toBe(403);
    // An API token cannot create a token (no escalation).
    const escal = await request(app)
      .post('/api/auth/tokens')
      .set('Authorization', `Bearer ${apiTok}`)
      .send({ name: 'x', scopes: ['read'] });
    expect(escal.status).toBe(403);

    await request(app)
      .delete(`/api/auth/tokens/${created.body.apiToken.id}`)
      .set('Authorization', `Bearer ${token}`);
    // On `/api/v1`, otherwise the surface 403 would mask the revocation we want to prove.
    const dead = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${apiTok}`);
    expect(dead.status).toBe(403);
    expect(dead.body.code).toBe('API_TOKEN_INVALID');
  });
});

describe('API — studio & admin', () => {
  it('GET /api/studio → studio configured', async () => {
    const r = await request(app).get('/api/studio').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.studio).toBeTruthy();
  });
  it('GET /api/admin/dashboard → metrics', async () => {
    const r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.users).toBeTruthy();
  });
});

describe('API — full pipeline + RBAC + media + comment', () => {
  it('project → shot → task → version → media (presigned upload) → comment flow', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };

    // Project (admin) + the artist's membership so that they have access
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Project ${suffix}` });
    expect(proj.status).toBe(201);
    const projectId = proj.body.project.id;
    if (artistId) {
      await request(app).post(`/api/projects/${projectId}/members`).set(auth).send({ userId: artistId });
    }

    // RBAC: the artist cannot create a sequence
    const seqByArtist = await request(app)
      .post('/api/sequences')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ projectId, name: 'X', code: `X${suffix}` });
    expect(seqByArtist.status).toBe(403);

    // Shot + Task (admin)
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: 'IT Shot', code: `SH${suffix}` });
    expect(shot.status).toBe(201);
    const task = await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: 'IT Task', type: 'COMPOSITING' });
    expect(task.status).toBe(201);

    // Version by the artist
    const ver = await request(app)
      .post('/api/versions')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ taskId: task.body.task.id });
    expect(ver.status).toBe(201);
    const versionId = ver.body.version.id;

    // Presigned upload of an image
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);
    const up = await request(app)
      .post('/api/media/upload-url')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ versionId, filename: 'it.jpg', contentType: 'image/jpeg', kind: 'IMAGE', size: jpg.length });
    expect(up.status).toBe(201);
    const { mediaObjectId, uploadUrl } = up.body;

    // Direct PUT to MinIO via the presigned URL
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: jpg,
    });
    expect(putRes.ok).toBe(true);

    // Finalize (magic bytes validation → PROCESSING/READY)
    const fin = await request(app)
      .post(`/api/media/${mediaObjectId}/finalize`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(fin.status).toBe(200);
    expect(fin.body.detectedExtension).toBe('.jpg');

    // Version list: `_count.media` reflects the real visibility (10.C2). This scenario checked that
    // the draft counted only for its uploader: it no longer can. Since phase 50 a media is born
    // published (draft mode off by default), so both accounts count 1. The visibility filter itself
    // has not changed and remains covered by `VersionService.test.ts` ("a draft only counts for its
    // uploader"), which sets up an unpublished media without depending on the upload flow.
    const versionsArtist = await request(app)
      .get(`/api/versions?taskId=${task.body.task.id}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(versionsArtist.status).toBe(200);
    expect(versionsArtist.body.versions.find((v: { id: number }) => v.id === versionId)._count.media).toBe(1);
    const versionsAdmin = await request(app).get(`/api/versions?taskId=${task.body.task.id}`).set(auth);
    expect(versionsAdmin.body.versions.find((v: { id: number }) => v.id === versionId)._count.media).toBe(1);

    // Comment on the media
    const cmt = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ mediaObjectId, content: 'Commentaire intégration', timestamp: 1 });
    expect(cmt.status).toBe(201);

    const list = await request(app)
      .get(`/api/comments?mediaObjectId=${mediaObjectId}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('client sharing: COMMENT link → public access + guest comment', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Share ${suffix}` });
    const projectId = proj.body.project.id;
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: 'S', code: `S${suffix}` });
    const task = await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: 'T', type: 'OTHER' });
    const ver = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });
    const versionId = ver.body.version.id;

    // 3D media (glTF): finalize → READY immediately (no worker needed to be visible client-side)
    const glb = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(60)]);
    const up = await request(app).post('/api/media/upload-url').set(auth).send({
      versionId,
      filename: 's.glb',
      contentType: 'model/gltf-binary',
      kind: 'MODEL_3D',
      size: glb.length,
    });
    await fetch(up.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'model/gltf-binary' },
      body: glb,
    });
    const fin = await request(app).post(`/api/media/${up.body.mediaObjectId}/finalize`).set(auth);
    expect(fin.body.media.status).toBe('READY');
    await request(app).patch(`/api/versions/${versionId}`).set(auth).send({ status: 'PUBLISHED' });
    // The media is published by default since phase 50 (`draftMode` disabled by default): it is
    // already visible client-side. The call is kept as-is: it also checks that publishing an
    // ALREADY published media remains a 200 with no effect, which the v1 API depends on.
    const mediaPub = await request(app).post(`/api/media/${up.body.mediaObjectId}/publish`).set(auth);
    expect(mediaPub.status).toBe(200);

    const link = await request(app).post('/api/share').set(auth).send({ projectId, permission: 'COMMENT' });
    expect(link.status).toBe(201);
    const tk = link.body.link.token;

    const pub = await request(app).get(`/api/client/${tk}`);
    expect(pub.status).toBe(200);
    expect(pub.body.media.length).toBeGreaterThanOrEqual(1);
    expect(pub.body.shareAuth).toBeTruthy();

    // 35.C: the sub-routes require the sharing session issued by the initial GET.
    const noAuth = await request(app)
      .post(`/api/client/${tk}/media/${up.body.mediaObjectId}/comments`)
      .send({ guestName: 'Client IT', content: 'Sans session' });
    expect(noAuth.status).toBe(401);

    const guest = await request(app)
      .post(`/api/client/${tk}/media/${up.body.mediaObjectId}/comments`)
      .set('X-Share-Auth', pub.body.shareAuth)
      .send({ guestName: 'Client IT', content: 'Commentaire invité' });
    expect(guest.status).toBe(201);

    // Hardened link (35.C): password + view limit.
    const hard = await request(app)
      .post('/api/share')
      .set(auth)
      .send({ projectId, permission: 'VIEW', password: 'secret-it', maxViews: 1, label: 'Client X' });
    expect(hard.status).toBe(201);
    expect(hard.body.link.hasPassword).toBe(true);
    const htk = hard.body.link.token;

    const locked = await request(app).get(`/api/client/${htk}`);
    expect(locked.status).toBe(200);
    expect(locked.body.locked).toBe(true);
    expect(locked.body.project).toBeUndefined();

    const badPw = await request(app).post(`/api/client/${htk}/unlock`).send({ password: 'mauvais' });
    expect(badPw.status).toBe(401);

    const unlock = await request(app).post(`/api/client/${htk}/unlock`).send({ password: 'secret-it' });
    expect(unlock.status).toBe(200);
    const opened = await request(app).get(`/api/client/${htk}`).set('X-Share-Auth', unlock.body.shareAuth);
    expect(opened.status).toBe(200);
    expect(opened.body.locked).toBe(false);

    // maxViews=1: a new session (new unlock) is refused, the existing one survives.
    const again = await request(app).post(`/api/client/${htk}/unlock`).send({ password: 'secret-it' });
    expect(again.status).toBe(410);
  });

  it('resumable multipart upload + dedup by hash (37.A/37.B)', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Multi ${suffix}` });
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId: proj.body.project.id, name: 'S', code: `MU${suffix}` });
    const task = await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: 'T', type: 'OTHER' });
    const ver = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });

    // 17 MB GLB (> 16 MB multipart threshold): 2 parts, no worker (READY at finalize).
    // The content carries a marker unique to the run: with identical bytes, dedup (37.B) would
    // recognise from the first `init` the media left by the previous run and return a server copy.
    // The multipart path would then never be exercised, and the request for parts would fail
    // (media without `multipartUploadId`).
    const { createHash, randomUUID } = await import('node:crypto');
    const glb = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(17 * 1024 * 1024 - 4)]);
    glb.write(randomUUID(), 4, 'ascii');
    const hash = createHash('sha256').update(glb).digest('hex');
    const base = {
      versionId: ver.body.version.id,
      filename: 'multi.glb',
      contentType: 'model/gltf-binary',
      kind: 'MODEL_3D',
      size: glb.length,
      contentHash: hash,
    };

    const init = await request(app).post('/api/media/multipart/init').set(auth).send(base);
    expect(init.status).toBe(201);
    const { mediaObjectId, partSize } = init.body as { mediaObjectId: number; partSize: number };
    expect(init.body.uploadedParts).toEqual([]);

    const putPart = async (n: number) => {
      const urls = await request(app)
        .post(`/api/media/multipart/${mediaObjectId}/parts`)
        .set(auth)
        .send({ partNumbers: [n] });
      const url = urls.body.urls[0].url as string;
      const body = glb.subarray((n - 1) * partSize, Math.min(n * partSize, glb.length));
      const r = await fetch(url, { method: 'PUT', body });
      expect(r.status).toBe(200);
      return (r.headers.get('etag') ?? '').replaceAll('"', '');
    };

    // Part 1 sent, then "cut off": a new init finds the upload and the part received.
    const etag1 = await putPart(1);
    const resume = await request(app).post('/api/media/multipart/init').set(auth).send(base);
    expect(resume.body.resumed).toBe(true);
    expect(resume.body.mediaObjectId).toBe(mediaObjectId);
    expect(resume.body.uploadedParts.map((p: { partNumber: number }) => p.partNumber)).toEqual([1]);

    const etag2 = await putPart(2);
    const complete = await request(app)
      .post(`/api/media/multipart/${mediaObjectId}/complete`)
      .set(auth)
      .send({
        parts: [
          { partNumber: 1, etag: etag1 },
          { partNumber: 2, etag: etag2 },
        ],
      });
    expect(complete.status).toBe(200);
    const fin = await request(app).post(`/api/media/${mediaObjectId}/finalize`).set(auth);
    expect(fin.body.media.status).toBe('READY');

    // Dedup: same content on another version → no bytes to transfer.
    const ver2 = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });
    const dedup = await request(app)
      .post('/api/media/multipart/init')
      .set(auth)
      .send({ ...base, versionId: ver2.body.version.id });
    expect(dedup.status).toBe(201);
    expect(dedup.body.deduplicated).toBe(true);
    const fin2 = await request(app).post(`/api/media/${dedup.body.mediaObjectId}/finalize`).set(auth);
    expect(fin2.body.media.status).toBe('READY');

    // Both media weigh 17 MB each in storage: the purge (DB + object) prevents a run on the
    // development database from leaving that much behind.
    for (const id of [mediaObjectId, dedup.body.mediaObjectId as number]) {
      const purged = await request(app).delete(`/api/media/${id}/purge`).set(auth);
      expect(purged.status).toBe(204);
    }
  });

  it('media thumbnail (10.G): POST /thumbnail stores an image and feeds thumbnailUrl', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Thumb ${suffix}` });
    const projectId = proj.body.project.id;
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: 'S', code: `TH${suffix}` });
    const task = await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: 'T', type: 'OTHER' });
    const ver = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });

    // Splat media (PLY): finalize → READY immediately (no worker).
    const ply = Buffer.concat([Buffer.from('ply\n', 'ascii'), Buffer.alloc(60)]);
    const up = await request(app).post('/api/media/upload-url').set(auth).send({
      versionId: ver.body.version.id,
      filename: 's.ply',
      contentType: 'application/octet-stream',
      kind: 'SPLAT',
      size: ply.length,
    });
    await fetch(up.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: ply,
    });
    const mediaId = up.body.mediaObjectId;
    const fin = await request(app).post(`/api/media/${mediaId}/finalize`).set(auth);
    expect(fin.body.media.status).toBe('READY');

    // non-image data URL → 400.
    const bad = await request(app)
      .post(`/api/media/${mediaId}/thumbnail`)
      .set(auth)
      .send({ dataUrl: 'data:text/plain;base64,aGVsbG8=' });
    expect(bad.status).toBe(400);

    // Minimal JPEG (magic FF D8 FF) → 200 + presigned thumbnailUrl.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]);
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const thumb = await request(app).post(`/api/media/${mediaId}/thumbnail`).set(auth).send({ dataUrl });
    expect(thumb.status).toBe(200);
    expect(thumb.body.thumbnailUrl).toBeTruthy();

    // The media detail now exposes the thumbnail.
    const detail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(detail.body.thumbnailUrl).toBeTruthy();

    // Reference images linked to a comment: added by the author, exposed with their commentId in
    // the detail, invalid comment refused, deletion OK.
    const badRef = await request(app)
      .post(`/api/media/${mediaId}/references`)
      .set(auth)
      .send({ dataUrl, commentId: 999999 });
    expect(badRef.status).toBe(400);

    const com = await request(app)
      .post('/api/comments')
      .set(auth)
      .send({ mediaObjectId: mediaId, content: 'porteur de référence' });
    expect(com.status).toBe(201);
    const commentId = com.body.comment.id;

    const ref = await request(app)
      .post(`/api/media/${mediaId}/references`)
      .set(auth)
      .send({ dataUrl, commentId, x: 0.2, y: 0.1, width: 0.4 });
    expect(ref.status).toBe(201);
    expect(ref.body.reference.commentId).toBe(commentId);

    const withRef = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(withRef.body.references).toHaveLength(1);
    expect(withRef.body.references[0].commentId).toBe(commentId);

    const delRef = await request(app)
      .delete(`/api/media/${mediaId}/references/${ref.body.reference.id}`)
      .set(auth);
    expect(delRef.status).toBe(204);

    // Thumbnail = presentation: stays editable after publication (exception to the lock).
    await request(app).post(`/api/media/${mediaId}/publish`).set(auth);
    const thumbAfterPublish = await request(app)
      .post(`/api/media/${mediaId}/thumbnail`)
      .set(auth)
      .send({ dataUrl });
    expect(thumbAfterPublish.status).toBe(200);
  });

  it('splat edits (10.G): PATCH /splat-edits + mask, locked on publication', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT SplatEdits ${suffix}` });
    const projectId = proj.body.project.id;
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: 'S', code: `TF${suffix}` });
    const task = await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: 'T', type: 'OTHER' });
    const ver = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });

    // Studio in DRAFT mode for the duration of this test: writing edits "for everyone" only lives
    // before publication (Phase 11 lock, closed in batch 14). `draftMode` is off by default since
    // phase 50 — a media is born published — and the setting is applied just before the explicit
    // publication, so that the suite gets back the default behaviour.
    const setDraftMode = (value: string) =>
      request(app).put('/api/studio/settings').set(auth).send({ key: 'draftMode', value });
    expect((await setDraftMode('true')).status).toBe(200);

    // Splat media (PLY) → READY.
    const ply = Buffer.concat([Buffer.from('ply\n', 'ascii'), Buffer.alloc(60)]);
    const up = await request(app).post('/api/media/upload-url').set(auth).send({
      versionId: ver.body.version.id,
      filename: 's.ply',
      contentType: 'application/octet-stream',
      kind: 'SPLAT',
      size: ply.length,
    });
    await fetch(up.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: ply,
    });
    const mediaId = up.body.mediaObjectId;
    await request(app).post(`/api/media/${mediaId}/finalize`).set(auth);
    // The media is indeed a DRAFT: that is the starting state of this whole block. Without the
    // setting applied above, it would be born published and the first write would answer 403 —
    // which would say nothing about the lock, only about a studio's mode.
    const draftDetail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(draftDetail.body.media.published).toBe(false);

    // Invalid edits (negative scale) → 400.
    const bad = await request(app)
      .patch(`/api/media/${mediaId}/splat-edits`)
      .set(auth)
      .send({
        edits: {
          transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [-1, 1, 1] },
          volumes: [],
        },
      });
    expect(bad.status).toBe(400);

    // Valid edits (TRS transform + crop volume) → 200 + media detail exposes them.
    const edits = {
      transform: {
        position: [1, 0, -2],
        quaternion: [0, 0.7071, 0, 0.7071],
        scale: [1.5, 1.5, 1.5],
      },
      volumes: [
        {
          shape: 'box',
          mode: 'delete',
          position: [0, 1, 0],
          quaternion: [0, 0, 0, 1],
          scale: [2, 2, 2],
        },
      ],
    };
    const patch = await request(app).patch(`/api/media/${mediaId}/splat-edits`).set(auth).send({ edits });
    expect(patch.status).toBe(200);
    const detail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(detail.body.splatEdits).toEqual(edits);
    expect(detail.body.splatMaskUrl).toBeNull();

    // Deletion mask (base64 bitset) → presigned URL exposed + count.
    const mask = Buffer.from([0b00000101, 0b00000010]); // splats 0, 2 and 9 masked
    const putMask = await request(app)
      .put(`/api/media/${mediaId}/splat-mask`)
      .set(auth)
      .send({ data: mask.toString('base64'), count: 3 });
    expect(putMask.status).toBe(200);
    expect(putMask.body.splatMaskUrl).toBeTruthy();
    const withMask = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(withMask.body.splatMaskUrl).toBeTruthy();
    expect(withMask.body.splatMaskCount).toBe(3);

    // Clearing the mask → detail without URL.
    await request(app).delete(`/api/media/${mediaId}/splat-mask`).set(auth);
    const noMask = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(noMask.body.splatMaskUrl).toBeNull();

    // Subset transforms (Phase 28): binary ops → presigned URL + count.
    const subsetOps = Buffer.alloc(148); // header (8) + 1 op: 16×float64 (128) + n (4) + 2 indices (8)
    subsetOps.writeUInt32LE(1, 0); // version
    subsetOps.writeUInt32LE(1, 4); // 1 op
    const putSubset = await request(app)
      .put(`/api/media/${mediaId}/splat-subset`)
      .set(auth)
      .send({ data: subsetOps.toString('base64'), count: 1 });
    expect(putSubset.status).toBe(200);
    expect(putSubset.body.splatSubsetUrl).toBeTruthy();
    const withSubset = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(withSubset.body.splatSubsetUrl).toBeTruthy();
    expect(withSubset.body.splatSubsetCount).toBe(1);
    await request(app).delete(`/api/media/${mediaId}/splat-subset`).set(auth);
    const noSubset = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(noSubset.body.splatSubsetUrl).toBeNull();

    // Persisted presentation (10.G-V5): camera + DoF + keyframe animation → detail exposes it.
    const presentation = {
      // aspect + roll persisted (Phase 17): the fixed frame and the tilt are replayed for everyone.
      camera: {
        position: { x: 0, y: 1, z: 5 },
        target: { x: 0, y: 0, z: 0 },
        fov: 50,
        aspect: 1.777,
        roll: 0.15,
      },
      dof: { focalDistance: 4.2, apertureAngle: 0.02 },
      // Camera animation F-curves v2 (Phase 17): position X + focal length channels.
      cameraAnim: {
        version: 2 as const,
        loop: true,
        channels: {
          px: {
            keys: [
              { t: 0, v: 0, mode: 'auto' as const },
              { t: 4000, v: 5, mode: 'linear' as const },
            ],
          },
          fov: { keys: [{ t: 0, v: 50, mode: 'auto' as const }] },
        },
      },
    };
    const putPres = await request(app)
      .patch(`/api/media/${mediaId}/splat-presentation`)
      .set(auth)
      .send({ presentation });
    expect(putPres.status).toBe(200);
    const withPres = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(withPres.body.splatPresentation).toEqual(presentation);
    // Invalid presentation (unknown tangent mode) → 400.
    const badPres = await request(app)
      .patch(`/api/media/${mediaId}/splat-presentation`)
      .set(auth)
      .send({
        presentation: {
          cameraAnim: { version: 2, loop: false, channels: { px: { keys: [{ t: 0, v: 0, mode: 'nope' }] } } },
        },
      });
    expect(badPres.status).toBe(400);

    // Publication → "for everyone" splat edits are REFUSED (Phase 50, batch 14).
    // This block used to expect 200s: the edits had been opened after publication, which exposed a
    // permanent "Save" button in a studio without drafts and rewrote the cloud under the eyes of
    // those commenting on it. It is deliberately rewritten: after publication, a cloud edit only
    // travels inside a comment.
    //
    // Starting state: edits and mask written BEFORE publication (previous block) — precisely what
    // the lock must leave intact.
    expect((await setDraftMode('false')).status).toBe(200);
    await request(app).post(`/api/media/${mediaId}/publish`).set(auth);
    const postPublish = await request(app)
      .patch(`/api/media/${mediaId}/splat-edits`)
      .set(auth)
      .send({ edits });
    expect(postPublish.status).toBe(403);
    expect(postPublish.body.code).toBe('PUBLISHED_LOCKED');
    const maskAfterPublish = await request(app)
      .put(`/api/media/${mediaId}/splat-mask`)
      .set(auth)
      .send({ data: mask.toString('base64'), count: 3 });
    expect(maskAfterPublish.status).toBe(403);
    const clearAfterPublish = await request(app).delete(`/api/media/${mediaId}/splat-mask`).set(auth);
    expect(clearAfterPublish.status).toBe(403);
    // The refusal erased nothing: the edits written before publication are still there.
    const editedDetail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(editedDetail.body.splatEdits).toEqual(edits);

    // The presentation (staging, V5) remains editable as well.
    const presAfterPublish = await request(app)
      .patch(`/api/media/${mediaId}/splat-presentation`)
      .set(auth)
      .send({ presentation: null });
    expect(presAfterPublish.status).toBe(200);
    const cleared = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(cleared.body.splatPresentation).toBeNull();

    // ---- What the edit becomes after publication: a PROPOSAL inside a comment.
    //
    // The whole gesture travels — transform and volumes in the part, deletions and subset ops as
    // attachments referenced by their key. Three things are checked here, and none can be seen in a
    // unit test: the presigned upload accepts the binary, the reference is refused if it is not an
    // attachment of the comment, and the object LEAVES storage with the comment.
    const presign = await request(app)
      .post('/api/comments/attachments/presign')
      .set(auth)
      .send({ filename: 'splat-mask.bin', contentType: 'application/octet-stream' });
    expect(presign.status).toBe(200);
    const blobKey = presign.body.key as string;
    const putBlob = await fetch(presign.body.url as string, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: mask,
    });
    expect(putBlob.ok).toBe(true);

    const proposal = {
      type: 'splat-edit',
      transform: edits.transform,
      volumes: edits.volumes,
      mask: { key: blobKey, count: 3 },
    };
    // Unattached reference: refused. This refusal is what guarantees that no object can be cited
    // without being collected — the leak already closed for comment images.
    const unattached = await request(app)
      .post('/api/comments')
      .set(auth)
      .send({ mediaObjectId: mediaId, content: 'masque orphelin', annotation: [proposal] });
    expect(unattached.status).toBe(400);
    expect(unattached.body.code).toBe('SPLAT_EDIT_UNATTACHED');

    const withProposal = await request(app)
      .post('/api/comments')
      .set(auth)
      .send({
        mediaObjectId: mediaId,
        content: 'nettoyage proposé',
        annotation: [proposal],
        attachments: [{ key: blobKey, name: 'splat-mask.bin', contentType: 'application/octet-stream' }],
      });
    expect(withProposal.status).toBe(201);
    const proposalId = withProposal.body.comment.id as number;
    // The attachment comes back presigned: it is through it, and through it alone, that the player's
    // viewer downloads the proposed mask.
    expect(withProposal.body.comment.attachments[0].url).toBeTruthy();
    expect((await storage.statObject(blobKey)).size).toBe(mask.length);

    const removed = await request(app).delete(`/api/comments/${proposalId}`).set(auth);
    expect(removed.status).toBe(204);
    await expect(storage.statObject(blobKey)).rejects.toBeDefined();
  });

  /**
   * Video cut was removed (Phase 50, batch 4). This test used to hold the former behaviour:
   * setting, erasing, hitting the publication lock. It is rewritten around what remains: the route
   * no longer exists, and a **historical** cut keeps being read and served.
   */
  it('cut removed: no route anymore, but a historical cut is still served', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Trim ${suffix}` });
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId: proj.body.project.id, name: 'S', code: `TR${suffix}` });
    const task = await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: 'T', type: 'OTHER' });
    const ver = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });

    // Minimal MP4 video (magic bytes 'ftyp') → PROCESSING (transcode), then READY forced:
    // the FFmpeg worker is a separate process, absent from the integration tests.
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom', 'ascii'),
      Buffer.alloc(64),
    ]);
    const up = await request(app).post('/api/media/upload-url').set(auth).send({
      versionId: ver.body.version.id,
      filename: 'v.mp4',
      contentType: 'video/mp4',
      kind: 'VIDEO',
      size: mp4.length,
    });
    await fetch(up.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4' },
      body: mp4,
    });
    const mediaId = up.body.mediaObjectId;
    // No finalize here: it would enqueue a transcode job that the docker stack's worker would
    // process during the test (rewriting the metadata → loss of the simulated cut).
    await prisma.mediaObject.update({
      where: { id: mediaId },
      data: { status: MediaStatus.READY, metadata: { fps: 24 } },
    });

    // The cut route is no longer mounted: nothing can set a cut anymore.
    const gone = await request(app)
      .patch(`/api/media/${mediaId}/trim`)
      .set(auth)
      .send({ trim: { inFrame: 10, outFrame: 50 } });
    expect(gone.status).toBe(404);

    // Historical cut, as a media cut before the removal stores it in the database: it stays exposed,
    // and the cut proxy remains the one the review plays.
    await prisma.mediaObject.update({
      where: { id: mediaId },
      data: {
        metadata: {
          fps: 24,
          proxyKey: `derived/${mediaId}/proxy.mp4`,
          trim: { inFrame: 10, outFrame: 50 },
          trimProxyKey: `derived/${mediaId}/proxy-trim.mp4`,
        },
      },
    });
    const detail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(detail.body.trim).toEqual({ inFrame: 10, outFrame: 50 });
    expect(detail.body.trimProxyReady).toBe(true);
    expect(detail.body.proxyUrl).toContain('proxy-trim.mp4');
  });
});

describe('API — sidebar tree (sequences + shots outside any sequence)', () => {
  it('counts shots outside a sequence and filters them via sequenceId=none', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };

    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Tree ${suffix}` });
    const projectId = proj.body.project.id;
    const seq = await request(app)
      .post('/api/sequences')
      .set(auth)
      .send({ projectId, name: 'Seq tree', code: `TR${suffix}` });
    const inSeq = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: 'Shot en séquence', code: `TA${suffix}`, sequenceId: seq.body.sequence.id });
    const orphan = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: 'Shot hors séquence', code: `TB${suffix}` });
    expect(inSeq.status).toBe(201);
    expect(orphan.status).toBe(201);

    // GET /api/sequences → count of shots outside a sequence
    const seqs = await request(app).get(`/api/sequences?projectId=${projectId}`).set(auth);
    expect(seqs.status).toBe(200);
    expect(seqs.body.unsequencedShots).toBe(1);
    expect(seqs.body.sequences.find((s: { id: number }) => s.id === seq.body.sequence.id)._count.shots).toBe(
      1,
    );

    // GET /api/shots?sequenceId=none → only the orphan shot
    const orphans = await request(app).get(`/api/shots?projectId=${projectId}&sequenceId=none`).set(auth);
    expect(orphans.status).toBe(200);
    expect(orphans.body.items.map((s: { id: number }) => s.id)).toEqual([orphan.body.shot.id]);

    // GET /api/shots?sequenceId=<id> → only the shot of the sequence
    const bySeq = await request(app)
      .get(`/api/shots?projectId=${projectId}&sequenceId=${seq.body.sequence.id}`)
      .set(auth);
    expect(bySeq.status).toBe(200);
    expect(bySeq.body.items.map((s: { id: number }) => s.id)).toEqual([inSeq.body.shot.id]);
  });
});

describe('API — global search (/api/search)', () => {
  it('finds entities by name/code and applies RBAC by membership', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const needle = `Zx${suffix}`; // improbable pattern, unique to the run

    // Pipeline in a project WITHOUT the artist's membership
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Search ${needle}` });
    const projectId = proj.body.project.id;
    const seq = await request(app)
      .post('/api/sequences')
      .set(auth)
      .send({ projectId, name: `Seq ${needle}`, code: `SQ${needle}` });
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: `Shot ${needle}`, code: `SH${needle}`, sequenceId: seq.body.sequence.id });
    await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: `Task ${needle}`, type: 'COMPOSITING' });

    // Admin: all entities come up (case-insensitive)
    const r = await request(app).get(`/api/search?q=${needle.toLowerCase()}`).set(auth);
    expect(r.status).toBe(200);
    expect(r.body.projects.map((p: { id: number }) => p.id)).toContain(projectId);
    expect(r.body.sequences.length).toBe(1);
    expect(r.body.shots.length).toBe(1);
    expect(r.body.tasks.length).toBe(1);

    // Non-member artist: no entity of this project leaks
    const rArtist = await request(app)
      .get(`/api/search?q=${needle}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(rArtist.status).toBe(200);
    expect(rArtist.body.projects).toEqual([]);
    expect(rArtist.body.sequences).toEqual([]);
    expect(rArtist.body.shots).toEqual([]);
    expect(rArtist.body.tasks).toEqual([]);

    // empty q → 400 (Zod)
    const empty = await request(app).get('/api/search?q=').set(auth);
    expect(empty.status).toBe(400);
  });
});

describe('API — breadcrumb context (/api/context)', () => {
  it('resolves the chain project → sequence → shot → task → version, applies RBAC and 404 otherwise', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };

    // Minimal pipeline: project (WITHOUT artist membership) + sequence + shot + task + version
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Context ${suffix}` });
    const projectId = proj.body.project.id;
    const seq = await request(app)
      .post('/api/sequences')
      .set(auth)
      .send({ projectId, name: 'Seq ctx', code: `SQ${suffix}` });
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: 'Shot ctx', code: `CX${suffix}`, sequenceId: seq.body.sequence.id });
    const task = await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: 'Task ctx', type: 'COMPOSITING' });
    const ver = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });

    // Full chain from the version
    const ctx = await request(app).get(`/api/context/version/${ver.body.version.id}`).set(auth);
    expect(ctx.status).toBe(200);
    expect(ctx.body.context.project.id).toBe(projectId);
    expect(ctx.body.context.sequence.id).toBe(seq.body.sequence.id);
    expect(ctx.body.context.shot.id).toBe(shot.body.shot.id);
    expect(ctx.body.context.task.id).toBe(task.body.task.id);
    expect(ctx.body.context.version.id).toBe(ver.body.version.id);

    // From the shot: no task/version in the chain
    const ctxShot = await request(app).get(`/api/context/shot/${shot.body.shot.id}`).set(auth);
    expect(ctxShot.status).toBe(200);
    expect(ctxShot.body.context.task).toBeUndefined();

    // RBAC: the artist is not a member of the project → 403
    const forbidden = await request(app)
      .get(`/api/context/task/${task.body.task.id}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(forbidden.status).toBe(403);

    // Unknown entity → 404; invalid entity → 400 (Zod)
    const missing = await request(app).get('/api/context/shot/999999').set(auth);
    expect(missing.status).toBe(404);
    const invalid = await request(app).get('/api/context/nimporte/1').set(auth);
    expect(invalid.status).toBe(400);
  });
});

describe('API — notifications (task assignment)', () => {
  it("notifies the assignee, exposes the unread counter, marks read / all read, scoped per user", async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const artistAuth = { Authorization: `Bearer ${artistToken}` };

    // Project + artist membership
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Notif ${suffix}` });
    const projectId = proj.body.project.id;
    await request(app).post(`/api/projects/${projectId}/members`).set(auth).send({ userId: artistId });

    // Task assigned to the artist (by the admin) → notification for the artist
    const shot = await request(app)
      .post('/api/shots')
      .set(auth)
      .send({ projectId, name: 'Notif shot', code: `NF${suffix}` });
    const task = await request(app)
      .post('/api/tasks')
      .set(auth)
      .send({ shotId: shot.body.shot.id, name: 'Notif task', type: 'ANIMATION', assigneeId: artistId });
    expect(task.status).toBe(201);
    const taskId = task.body.task.id;

    // The artist sees the notification: navigable type + reference = task + unread counter
    const listArtist = await request(app).get('/api/notifications').set(artistAuth);
    expect(listArtist.status).toBe(200);
    const notif = listArtist.body.notifications.find(
      (n: { type: string; referenceId: number }) => n.type === 'TASK_ASSIGNED' && n.referenceId === taskId,
    );
    expect(notif).toBeTruthy();
    expect(notif.projectId).toBe(projectId);
    expect(notif.isRead).toBe(false);
    expect(listArtist.body.unread).toBeGreaterThanOrEqual(1);

    // Per-user scope: the admin (author of the assignment) is not notified
    const listAdmin = await request(app).get('/api/notifications').set(auth);
    expect(
      listAdmin.body.notifications.some(
        (n: { type: string; referenceId: number }) => n.type === 'TASK_ASSIGNED' && n.referenceId === taskId,
      ),
    ).toBe(false);

    // RBAC: the admin cannot mark the artist's notification (404); the artist can
    const foreign = await request(app).patch(`/api/notifications/${notif.id}/read`).set(auth);
    expect(foreign.status).toBe(404);
    const read = await request(app).patch(`/api/notifications/${notif.id}/read`).set(artistAuth);
    expect(read.status).toBe(200);
    expect(read.body.notification.isRead).toBe(true);

    // POST read-all → no unread left for the artist
    const readAll = await request(app).post('/api/notifications/read-all').set(artistAuth);
    expect(readAll.status).toBe(200);
    const after = await request(app).get('/api/notifications').set(artistAuth);
    expect(after.body.unread).toBe(0);
  });
});
