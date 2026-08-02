// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { MediaStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Tests d'intégration API (nécessitent Postgres/Redis/MinIO).
 * Robuste en local (DB seedée) comme en CI (DB vierge après migrate).
 */
const app = createApp();
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

  // Crée un artiste dédié au run (email unique) pour les tests RBAC
  const email = `it-artist-${Date.now()}@review.local`;
  const created = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ email, password: 'artist1234', name: 'IT Artist', role: 'ARTIST' });
  artistId = created.body.user?.id ?? 0;
  const login = await request(app).post('/api/auth/login').send({ email, password: 'artist1234' });
  artistToken = login.body.token;
});

describe('API — santé & setup', () => {
  it('GET /health → 200', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });
  it('GET /api/setup/status → booléen', async () => {
    const r = await request(app).get('/api/setup/status');
    expect(r.status).toBe(200);
    expect(typeof r.body.needsSetup).toBe('boolean');
  });
});

describe('API — auth & RBAC', () => {
  it('un token admin est disponible', () => {
    expect(token).toBeTruthy();
  });
  it('GET /api/projects sans token → 401', async () => {
    const r = await request(app).get('/api/projects');
    expect(r.status).toBe(401);
  });
  it('GET /api/projects avec token → 200 + tableau', async () => {
    const r = await request(app).get('/api/projects').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    expect(typeof r.body.total).toBe('number');
  });
  it('GET /api/projects paginé → enveloppe { items, total, page, pageSize } bornée', async () => {
    // Deux projets au moins pour vérifier le bornage.
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
    // pageSize hors borne (> 100) → rejeté par Zod (400).
    const bad = await request(app).get('/api/projects?pageSize=500').set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(400);
  });
  it('GET /api/auth/me → utilisateur courant', async () => {
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('ADMIN');
  });

  it('sessions révocables (36.B) : login → liste → logout → token mort', async () => {
    // Nouveau login dédié (mêmes comptes candidats que le beforeAll) → session propre.
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
    // La révocation invalide aussi l'access token (cache court-circuité par revokeSession).
    const after = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${t}`);
    expect(after.status).toBe(401);
  });

  it("tokens d'API (36.C) : scope read → GET ok, écriture 403 ; révocation immédiate", async () => {
    const created = await request(app)
      .post('/api/auth/tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'IT read', scopes: ['read'] });
    expect(created.status).toBe(201);
    const apiTok = created.body.token as string;
    expect(apiTok).toMatch(/^rvk_/);

    const read = await request(app).get('/api/projects').set('Authorization', `Bearer ${apiTok}`);
    expect(read.status).toBe(200);
    const write = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${apiTok}`)
      .send({ name: 'refusé' });
    expect(write.status).toBe(403);
    // Un token d'API ne peut pas créer de token (pas d'escalade).
    const escal = await request(app)
      .post('/api/auth/tokens')
      .set('Authorization', `Bearer ${apiTok}`)
      .send({ name: 'x', scopes: ['read'] });
    expect(escal.status).toBe(403);

    await request(app)
      .delete(`/api/auth/tokens/${created.body.apiToken.id}`)
      .set('Authorization', `Bearer ${token}`);
    const dead = await request(app).get('/api/projects').set('Authorization', `Bearer ${apiTok}`);
    expect(dead.status).toBe(403);
  });
});

describe('API — studio & admin', () => {
  it('GET /api/studio → studio configuré', async () => {
    const r = await request(app).get('/api/studio').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.studio).toBeTruthy();
  });
  it('GET /api/admin/dashboard → métriques', async () => {
    const r = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.users).toBeTruthy();
  });
});

describe('API — pipeline complet + RBAC + média + commentaire', () => {
  it('flux projet → shot → task → version → média (upload présigné) → commentaire', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };

    // Projet (admin) + membership de l'artiste pour qu'il y ait accès
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Project ${suffix}` });
    expect(proj.status).toBe(201);
    const projectId = proj.body.project.id;
    if (artistId) {
      await request(app).post(`/api/projects/${projectId}/members`).set(auth).send({ userId: artistId });
    }

    // RBAC : l'artiste ne peut pas créer de séquence
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

    // Version par l'artiste
    const ver = await request(app)
      .post('/api/versions')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ taskId: task.body.task.id });
    expect(ver.status).toBe(201);
    const versionId = ver.body.version.id;

    // Upload présigné d'une image
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);
    const up = await request(app)
      .post('/api/media/upload-url')
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ versionId, filename: 'it.jpg', contentType: 'image/jpeg', kind: 'IMAGE', size: jpg.length });
    expect(up.status).toBe(201);
    const { mediaObjectId, uploadUrl } = up.body;

    // PUT direct vers MinIO via l'URL présignée
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: jpg,
    });
    expect(putRes.ok).toBe(true);

    // Finalize (validation magic bytes → PROCESSING/READY)
    const fin = await request(app)
      .post(`/api/media/${mediaObjectId}/finalize`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(fin.status).toBe(200);
    expect(fin.body.detectedExtension).toBe('.jpg');

    // Liste des versions : _count.media reflète la visibilité réelle (10.C2) —
    // le brouillon compte pour son uploader, pas pour un autre membre.
    const versionsArtist = await request(app)
      .get(`/api/versions?taskId=${task.body.task.id}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(versionsArtist.status).toBe(200);
    expect(versionsArtist.body.versions.find((v: { id: number }) => v.id === versionId)._count.media).toBe(1);
    const versionsAdmin = await request(app).get(`/api/versions?taskId=${task.body.task.id}`).set(auth);
    expect(versionsAdmin.body.versions.find((v: { id: number }) => v.id === versionId)._count.media).toBe(0);

    // Commentaire sur le média
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

  it('partage client : lien COMMENT → accès public + commentaire invité', async () => {
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

    // Média 3D (glTF) : finalize → READY immédiat (pas de worker requis pour être visible côté client)
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
    // Le média est en brouillon par défaut (workflow draft 9.A2) : il faut le publier
    // explicitement pour qu'il soit visible côté client (partage externe).
    const mediaPub = await request(app).post(`/api/media/${up.body.mediaObjectId}/publish`).set(auth);
    expect(mediaPub.status).toBe(200);

    const link = await request(app).post('/api/share').set(auth).send({ projectId, permission: 'COMMENT' });
    expect(link.status).toBe(201);
    const tk = link.body.link.token;

    const pub = await request(app).get(`/api/client/${tk}`);
    expect(pub.status).toBe(200);
    expect(pub.body.media.length).toBeGreaterThanOrEqual(1);
    expect(pub.body.shareAuth).toBeTruthy();

    // 35.C : les sous-routes exigent la session de partage émise par le GET initial.
    const noAuth = await request(app)
      .post(`/api/client/${tk}/media/${up.body.mediaObjectId}/comments`)
      .send({ guestName: 'Client IT', content: 'Sans session' });
    expect(noAuth.status).toBe(401);

    const guest = await request(app)
      .post(`/api/client/${tk}/media/${up.body.mediaObjectId}/comments`)
      .set('X-Share-Auth', pub.body.shareAuth)
      .send({ guestName: 'Client IT', content: 'Commentaire invité' });
    expect(guest.status).toBe(201);

    // Lien durci (35.C) : mot de passe + limite de vues.
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

    // maxViews=1 : une nouvelle session (nouveau unlock) est refusée, l'existante survit.
    const again = await request(app).post(`/api/client/${htk}/unlock`).send({ password: 'secret-it' });
    expect(again.status).toBe(410);
  });

  it('upload multipart résumable + dédup par hash (37.A/37.B)', async () => {
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

    // GLB de 17 Mo (> seuil multipart 16 Mo) : 2 parts, pas de worker (READY au finalize).
    const glb = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(17 * 1024 * 1024 - 4)]);
    const { createHash } = await import('node:crypto');
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

    // Part 1 envoyée, puis « coupure » : un nouvel init retrouve l'upload et la part reçue.
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

    // Dédup : même contenu sur une autre version → aucun octet à transférer.
    const ver2 = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });
    const dedup = await request(app)
      .post('/api/media/multipart/init')
      .set(auth)
      .send({ ...base, versionId: ver2.body.version.id });
    expect(dedup.status).toBe(201);
    expect(dedup.body.deduplicated).toBe(true);
    const fin2 = await request(app).post(`/api/media/${dedup.body.mediaObjectId}/finalize`).set(auth);
    expect(fin2.body.media.status).toBe('READY');
  });

  it('miniature média (10.G) : POST /thumbnail stocke une image et alimente thumbnailUrl', async () => {
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

    // Média splat (PLY) : finalize → READY immédiat (aucun worker).
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

    // data URL non-image → 400.
    const bad = await request(app)
      .post(`/api/media/${mediaId}/thumbnail`)
      .set(auth)
      .send({ dataUrl: 'data:text/plain;base64,aGVsbG8=' });
    expect(bad.status).toBe(400);

    // JPEG minimal (magic FF D8 FF) → 200 + thumbnailUrl présignée.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]);
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const thumb = await request(app).post(`/api/media/${mediaId}/thumbnail`).set(auth).send({ dataUrl });
    expect(thumb.status).toBe(200);
    expect(thumb.body.thumbnailUrl).toBeTruthy();

    // Le détail média expose désormais la miniature.
    const detail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(detail.body.thumbnailUrl).toBeTruthy();

    // Images de référence liées à un commentaire : ajout par l'auteur, exposées avec
    // leur commentId dans le détail, commentaire invalide refusé, suppression OK.
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

    // Miniature = présentation : reste modifiable après publication (exception au verrou).
    await request(app).post(`/api/media/${mediaId}/publish`).set(auth);
    const thumbAfterPublish = await request(app)
      .post(`/api/media/${mediaId}/thumbnail`)
      .set(auth)
      .send({ dataUrl });
    expect(thumbAfterPublish.status).toBe(200);
  });

  it('éditions splat (10.G) : PATCH /splat-edits + masque, verrouillés à la publication', async () => {
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

    // Média splat (PLY) → READY.
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

    // Éditions invalides (échelle négative) → 400.
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

    // Éditions valides (transform TRS + volume de crop) → 200 + détail média les expose.
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

    // Masque de suppression (bitset base64) → URL présignée exposée + compte.
    const mask = Buffer.from([0b00000101, 0b00000010]); // splats 0, 2 et 9 masqués
    const putMask = await request(app)
      .put(`/api/media/${mediaId}/splat-mask`)
      .set(auth)
      .send({ data: mask.toString('base64'), count: 3 });
    expect(putMask.status).toBe(200);
    expect(putMask.body.splatMaskUrl).toBeTruthy();
    const withMask = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(withMask.body.splatMaskUrl).toBeTruthy();
    expect(withMask.body.splatMaskCount).toBe(3);

    // Effacement du masque → détail sans URL.
    await request(app).delete(`/api/media/${mediaId}/splat-mask`).set(auth);
    const noMask = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(noMask.body.splatMaskUrl).toBeNull();

    // Transformations de sous-ensembles (Phase 28) : ops binaires → URL présignée + compte.
    const subsetOps = Buffer.alloc(148); // en-tête (8) + 1 op : 16×float64 (128) + n (4) + 2 indices (8)
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

    // Présentation persistée (10.G-V5) : caméra + DoF + animation keyframe → détail l'expose.
    const presentation = {
      // aspect + roll persistés (Phase 17) : le cadre fixe et le tilt sont rejoués pour tous.
      camera: {
        position: { x: 0, y: 1, z: 5 },
        target: { x: 0, y: 0, z: 0 },
        fov: 50,
        aspect: 1.777,
        roll: 0.15,
      },
      dof: { focalDistance: 4.2, apertureAngle: 0.02 },
      // Animation caméra F-curves v2 (Phase 17) : canaux position X + focale.
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
    // Présentation invalide (mode de tangente inconnu) → 400.
    const badPres = await request(app)
      .patch(`/api/media/${mediaId}/splat-presentation`)
      .set(auth)
      .send({
        presentation: {
          cameraAnim: { version: 2, loop: false, channels: { px: { keys: [{ t: 0, v: 0, mode: 'nope' }] } } },
        },
      });
    expect(badPres.status).toBe(400);

    // Publication → verrou définitif (Phase 11) : toute édition du splat est refusée (403).
    await request(app).post(`/api/media/${mediaId}/publish`).set(auth);
    const postPublish = await request(app)
      .patch(`/api/media/${mediaId}/splat-edits`)
      .set(auth)
      .send({ edits });
    expect(postPublish.status).toBe(403);
    const maskAfterPublish = await request(app)
      .put(`/api/media/${mediaId}/splat-mask`)
      .set(auth)
      .send({ data: mask.toString('base64'), count: 3 });
    expect(maskAfterPublish.status).toBe(403);
    const clearAfterPublish = await request(app).delete(`/api/media/${mediaId}/splat-mask`).set(auth);
    expect(clearAfterPublish.status).toBe(403);
    // Les éditions pré-publication restent servies telles quelles.
    const lockedDetail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(lockedDetail.body.splatEdits).toEqual(edits);

    // Seule la présentation (mise en scène, V5) reste modifiable après publication.
    const presAfterPublish = await request(app)
      .patch(`/api/media/${mediaId}/splat-presentation`)
      .set(auth)
      .send({ presentation: null });
    expect(presAfterPublish.status).toBe(200);
    const cleared = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(cleared.body.splatPresentation).toBeNull();
  });

  it('trim vidéo (10.G-V10) : non-destructif, bornes validées, verrouillé à la publication', async () => {
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

    // Vidéo MP4 minimale (magic bytes 'ftyp') → PROCESSING (transcode), puis READY forcé :
    // le worker FFmpeg est un process séparé, absent des tests d'intégration.
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
    // Pas de finalize ici : il enqueuerait un job transcode que le worker de la stack docker
    // traiterait pendant le test (réécriture du metadata → perte du trim). L'objet du test est
    // le trim et son verrou de publication — le média est figé READY directement.
    await prisma.mediaObject.update({
      where: { id: mediaId },
      data: { status: MediaStatus.READY, metadata: { fps: 24 } },
    });

    // Bornes invalides → 400.
    const bad = await request(app)
      .patch(`/api/media/${mediaId}/trim`)
      .set(auth)
      .send({ trim: { inFrame: 50, outFrame: 10 } });
    expect(bad.status).toBe(400);

    // Trim valide (brouillon) : bornes exposées, proxy pas encore produit.
    const set = await request(app)
      .patch(`/api/media/${mediaId}/trim`)
      .set(auth)
      .send({ trim: { inFrame: 10, outFrame: 50 } });
    expect(set.status).toBe(200);
    expect(set.body.trim).toEqual({ inFrame: 10, outFrame: 50 });
    expect(set.body.trimProxyReady).toBe(false);
    const detail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(detail.body.trim).toEqual({ inFrame: 10, outFrame: 50 });

    // Effacement du trim (brouillon) → retour au proxy d'origine.
    const clear = await request(app).patch(`/api/media/${mediaId}/trim`).set(auth).send({ trim: null });
    expect(clear.status).toBe(200);
    const cleared2 = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(cleared2.body.trim).toBeNull();

    // Re-pose puis publication → verrou définitif (Phase 11) : tout trim est refusé (403).
    await request(app)
      .patch(`/api/media/${mediaId}/trim`)
      .set(auth)
      .send({ trim: { inFrame: 10, outFrame: 50 } });
    await request(app).post(`/api/media/${mediaId}/publish`).set(auth);
    const retrim = await request(app)
      .patch(`/api/media/${mediaId}/trim`)
      .set(auth)
      .send({ trim: { inFrame: 0, outFrame: 30 } });
    expect(retrim.status).toBe(403);
    const clearAfterPublish = await request(app)
      .patch(`/api/media/${mediaId}/trim`)
      .set(auth)
      .send({ trim: null });
    expect(clearAfterPublish.status).toBe(403);
    // Le trim posé avant publication reste servi tel quel.
    const lockedDetail = await request(app).get(`/api/media/${mediaId}`).set(auth);
    expect(lockedDetail.body.trim).toEqual({ inFrame: 10, outFrame: 50 });
  });
});

describe('API — arbre sidebar (séquences + shots hors séquence)', () => {
  it('compte les shots hors séquence et les filtre via sequenceId=none', async () => {
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

    // GET /api/sequences → compteur de shots hors séquence
    const seqs = await request(app).get(`/api/sequences?projectId=${projectId}`).set(auth);
    expect(seqs.status).toBe(200);
    expect(seqs.body.unsequencedShots).toBe(1);
    expect(seqs.body.sequences.find((s: { id: number }) => s.id === seq.body.sequence.id)._count.shots).toBe(
      1,
    );

    // GET /api/shots?sequenceId=none → uniquement le shot orphelin
    const orphans = await request(app).get(`/api/shots?projectId=${projectId}&sequenceId=none`).set(auth);
    expect(orphans.status).toBe(200);
    expect(orphans.body.items.map((s: { id: number }) => s.id)).toEqual([orphan.body.shot.id]);

    // GET /api/shots?sequenceId=<id> → uniquement le shot de la séquence
    const bySeq = await request(app)
      .get(`/api/shots?projectId=${projectId}&sequenceId=${seq.body.sequence.id}`)
      .set(auth);
    expect(bySeq.status).toBe(200);
    expect(bySeq.body.items.map((s: { id: number }) => s.id)).toEqual([inSeq.body.shot.id]);
  });
});

describe('API — recherche globale (/api/search)', () => {
  it('trouve les entités par nom/code et applique le RBAC par membership', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const needle = `Zx${suffix}`; // motif improbable, unique au run

    // Pipeline dans un projet SANS membership artiste
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

    // Admin : toutes les entités remontent (insensible à la casse)
    const r = await request(app).get(`/api/search?q=${needle.toLowerCase()}`).set(auth);
    expect(r.status).toBe(200);
    expect(r.body.projects.map((p: { id: number }) => p.id)).toContain(projectId);
    expect(r.body.sequences.length).toBe(1);
    expect(r.body.shots.length).toBe(1);
    expect(r.body.tasks.length).toBe(1);

    // Artiste non membre : aucune entité de ce projet ne fuit
    const rArtist = await request(app)
      .get(`/api/search?q=${needle}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(rArtist.status).toBe(200);
    expect(rArtist.body.projects).toEqual([]);
    expect(rArtist.body.sequences).toEqual([]);
    expect(rArtist.body.shots).toEqual([]);
    expect(rArtist.body.tasks).toEqual([]);

    // q vide → 400 (Zod)
    const empty = await request(app).get('/api/search?q=').set(auth);
    expect(empty.status).toBe(400);
  });
});

describe('API — contexte breadcrumb (/api/context)', () => {
  it('résout la chaîne projet → séquence → shot → tâche → version, applique le RBAC et 404 sinon', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };

    // Pipeline minimal : projet (SANS membership artiste) + séquence + shot + tâche + version
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

    // Chaîne complète depuis la version
    const ctx = await request(app).get(`/api/context/version/${ver.body.version.id}`).set(auth);
    expect(ctx.status).toBe(200);
    expect(ctx.body.context.project.id).toBe(projectId);
    expect(ctx.body.context.sequence.id).toBe(seq.body.sequence.id);
    expect(ctx.body.context.shot.id).toBe(shot.body.shot.id);
    expect(ctx.body.context.task.id).toBe(task.body.task.id);
    expect(ctx.body.context.version.id).toBe(ver.body.version.id);

    // Depuis le shot : pas de task/version dans la chaîne
    const ctxShot = await request(app).get(`/api/context/shot/${shot.body.shot.id}`).set(auth);
    expect(ctxShot.status).toBe(200);
    expect(ctxShot.body.context.task).toBeUndefined();

    // RBAC : l'artiste n'est pas membre du projet → 403
    const forbidden = await request(app)
      .get(`/api/context/task/${task.body.task.id}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(forbidden.status).toBe(403);

    // Entité inconnue → 404 ; entité invalide → 400 (Zod)
    const missing = await request(app).get('/api/context/shot/999999').set(auth);
    expect(missing.status).toBe(404);
    const invalid = await request(app).get('/api/context/nimporte/1').set(auth);
    expect(invalid.status).toBe(400);
  });
});

describe('API — notifications (assignation de tâche)', () => {
  it("notifie l'assigné, expose le compteur non-lus, marque lu / tout lu, scope par utilisateur", async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const artistAuth = { Authorization: `Bearer ${artistToken}` };

    // Projet + membership de l'artiste
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: `IT Notif ${suffix}` });
    const projectId = proj.body.project.id;
    await request(app).post(`/api/projects/${projectId}/members`).set(auth).send({ userId: artistId });

    // Tâche assignée à l'artiste (par l'admin) → notification pour l'artiste
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

    // L'artiste voit la notification : type navigable + référence = tâche + compteur non-lus
    const listArtist = await request(app).get('/api/notifications').set(artistAuth);
    expect(listArtist.status).toBe(200);
    const notif = listArtist.body.notifications.find(
      (n: { type: string; referenceId: number }) => n.type === 'TASK_ASSIGNED' && n.referenceId === taskId,
    );
    expect(notif).toBeTruthy();
    expect(notif.projectId).toBe(projectId);
    expect(notif.isRead).toBe(false);
    expect(listArtist.body.unread).toBeGreaterThanOrEqual(1);

    // Scope par utilisateur : l'admin (auteur de l'assignation) n'est pas notifié
    const listAdmin = await request(app).get('/api/notifications').set(auth);
    expect(
      listAdmin.body.notifications.some(
        (n: { type: string; referenceId: number }) => n.type === 'TASK_ASSIGNED' && n.referenceId === taskId,
      ),
    ).toBe(false);

    // RBAC : l'admin ne peut pas marquer la notification de l'artiste (404) ; l'artiste oui
    const foreign = await request(app).patch(`/api/notifications/${notif.id}/read`).set(auth);
    expect(foreign.status).toBe(404);
    const read = await request(app).patch(`/api/notifications/${notif.id}/read`).set(artistAuth);
    expect(read.status).toBe(200);
    expect(read.body.notification.isRead).toBe(true);

    // POST read-all → plus aucune non-lue pour l'artiste
    const readAll = await request(app).post('/api/notifications/read-all').set(artistAuth);
    expect(readAll.status).toBe(200);
    const after = await request(app).get('/api/notifications').set(artistAuth);
    expect(after.body.unread).toBe(0);
  });
});
