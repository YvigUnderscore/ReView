import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

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
    const r = await request(app)
      .post('/api/setup')
      .send({ studioName: 'CI Studio', adminEmail: 'ci-admin@review.local', adminPassword: 'admin1234', adminName: 'CI' });
    token = r.body.token;
  } else {
    for (const email of ['admin@review.local', 'ci-admin@review.local']) {
      const r = await request(app).post('/api/auth/login').send({ email, password: 'admin1234' });
      if (r.status === 200) { token = r.body.token; break; }
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
    expect(Array.isArray(r.body.projects)).toBe(true);
  });
  it('GET /api/auth/me → utilisateur courant', async () => {
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('ADMIN');
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
    const proj = await request(app).post('/api/projects').set(auth).send({ name: `IT Project ${suffix}` });
    expect(proj.status).toBe(201);
    const projectId = proj.body.project.id;
    if (artistId) {
      await request(app).post(`/api/projects/${projectId}/members`).set(auth).send({ userId: artistId });
    }

    // RBAC : l'artiste ne peut pas créer de séquence
    const seqByArtist = await request(app)
      .post('/api/sequences').set('Authorization', `Bearer ${artistToken}`)
      .send({ projectId, name: 'X', code: `X${suffix}` });
    expect(seqByArtist.status).toBe(403);

    // Shot + Task (admin)
    const shot = await request(app).post('/api/shots').set(auth).send({ projectId, name: 'IT Shot', code: `SH${suffix}` });
    expect(shot.status).toBe(201);
    const task = await request(app).post('/api/tasks').set(auth).send({ shotId: shot.body.shot.id, name: 'IT Task', type: 'COMPOSITING' });
    expect(task.status).toBe(201);

    // Version par l'artiste
    const ver = await request(app).post('/api/versions').set('Authorization', `Bearer ${artistToken}`).send({ taskId: task.body.task.id });
    expect(ver.status).toBe(201);
    const versionId = ver.body.version.id;

    // Upload présigné d'une image
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);
    const up = await request(app).post('/api/media/upload-url').set('Authorization', `Bearer ${artistToken}`)
      .send({ versionId, filename: 'it.jpg', contentType: 'image/jpeg', kind: 'IMAGE', size: jpg.length });
    expect(up.status).toBe(201);
    const { mediaObjectId, uploadUrl } = up.body;

    // PUT direct vers MinIO via l'URL présignée
    const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpg });
    expect(putRes.ok).toBe(true);

    // Finalize (validation magic bytes → PROCESSING/READY)
    const fin = await request(app).post(`/api/media/${mediaObjectId}/finalize`).set('Authorization', `Bearer ${artistToken}`);
    expect(fin.status).toBe(200);
    expect(fin.body.detectedExtension).toBe('.jpg');

    // Commentaire sur le média
    const cmt = await request(app).post('/api/comments').set('Authorization', `Bearer ${artistToken}`)
      .send({ mediaObjectId, content: 'Commentaire intégration', timestamp: 1 });
    expect(cmt.status).toBe(201);

    const list = await request(app).get(`/api/comments?mediaObjectId=${mediaObjectId}`).set('Authorization', `Bearer ${artistToken}`);
    expect(list.status).toBe(200);
    expect(list.body.comments.length).toBeGreaterThanOrEqual(1);
  });

  it('partage client : lien COMMENT → accès public + commentaire invité', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const proj = await request(app).post('/api/projects').set(auth).send({ name: `IT Share ${suffix}` });
    const projectId = proj.body.project.id;
    const shot = await request(app).post('/api/shots').set(auth).send({ projectId, name: 'S', code: `S${suffix}` });
    const task = await request(app).post('/api/tasks').set(auth).send({ shotId: shot.body.shot.id, name: 'T', type: 'OTHER' });
    const ver = await request(app).post('/api/versions').set(auth).send({ taskId: task.body.task.id });
    const versionId = ver.body.version.id;

    // Média 3D (glTF) : finalize → READY immédiat (pas de worker requis pour être visible côté client)
    const glb = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(60)]);
    const up = await request(app).post('/api/media/upload-url').set(auth).send({ versionId, filename: 's.glb', contentType: 'model/gltf-binary', kind: 'MODEL_3D', size: glb.length });
    await fetch(up.body.uploadUrl, { method: 'PUT', headers: { 'content-type': 'model/gltf-binary' }, body: glb });
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

    const guest = await request(app).post(`/api/client/${tk}/media/${up.body.mediaObjectId}/comments`)
      .send({ guestName: 'Client IT', content: 'Commentaire invité' });
    expect(guest.status).toBe(201);
  });
});
