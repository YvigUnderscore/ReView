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

    // Liste des versions : _count.media reflète la visibilité réelle (10.C2) —
    // le brouillon compte pour son uploader, pas pour un autre membre.
    const versionsArtist = await request(app).get(`/api/versions?taskId=${task.body.task.id}`).set('Authorization', `Bearer ${artistToken}`);
    expect(versionsArtist.status).toBe(200);
    expect(versionsArtist.body.versions.find((v: { id: number }) => v.id === versionId)._count.media).toBe(1);
    const versionsAdmin = await request(app).get(`/api/versions?taskId=${task.body.task.id}`).set(auth);
    expect(versionsAdmin.body.versions.find((v: { id: number }) => v.id === versionId)._count.media).toBe(0);

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

describe('API — arbre sidebar (séquences + shots hors séquence)', () => {
  it('compte les shots hors séquence et les filtre via sequenceId=none', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };

    const proj = await request(app).post('/api/projects').set(auth).send({ name: `IT Tree ${suffix}` });
    const projectId = proj.body.project.id;
    const seq = await request(app).post('/api/sequences').set(auth).send({ projectId, name: 'Seq tree', code: `TR${suffix}` });
    const inSeq = await request(app).post('/api/shots').set(auth)
      .send({ projectId, name: 'Shot en séquence', code: `TA${suffix}`, sequenceId: seq.body.sequence.id });
    const orphan = await request(app).post('/api/shots').set(auth)
      .send({ projectId, name: 'Shot hors séquence', code: `TB${suffix}` });
    expect(inSeq.status).toBe(201);
    expect(orphan.status).toBe(201);

    // GET /api/sequences → compteur de shots hors séquence
    const seqs = await request(app).get(`/api/sequences?projectId=${projectId}`).set(auth);
    expect(seqs.status).toBe(200);
    expect(seqs.body.unsequencedShots).toBe(1);
    expect(seqs.body.sequences.find((s: { id: number }) => s.id === seq.body.sequence.id)._count.shots).toBe(1);

    // GET /api/shots?sequenceId=none → uniquement le shot orphelin
    const orphans = await request(app).get(`/api/shots?projectId=${projectId}&sequenceId=none`).set(auth);
    expect(orphans.status).toBe(200);
    expect(orphans.body.shots.map((s: { id: number }) => s.id)).toEqual([orphan.body.shot.id]);

    // GET /api/shots?sequenceId=<id> → uniquement le shot de la séquence
    const bySeq = await request(app).get(`/api/shots?projectId=${projectId}&sequenceId=${seq.body.sequence.id}`).set(auth);
    expect(bySeq.status).toBe(200);
    expect(bySeq.body.shots.map((s: { id: number }) => s.id)).toEqual([inSeq.body.shot.id]);
  });
});

describe('API — recherche globale (/api/search)', () => {
  it('trouve les entités par nom/code et applique le RBAC par membership', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const needle = `Zx${suffix}`; // motif improbable, unique au run

    // Pipeline dans un projet SANS membership artiste
    const proj = await request(app).post('/api/projects').set(auth).send({ name: `IT Search ${needle}` });
    const projectId = proj.body.project.id;
    const seq = await request(app).post('/api/sequences').set(auth).send({ projectId, name: `Seq ${needle}`, code: `SQ${needle}` });
    const shot = await request(app).post('/api/shots').set(auth)
      .send({ projectId, name: `Shot ${needle}`, code: `SH${needle}`, sequenceId: seq.body.sequence.id });
    await request(app).post('/api/tasks').set(auth).send({ shotId: shot.body.shot.id, name: `Task ${needle}`, type: 'COMPOSITING' });

    // Admin : toutes les entités remontent (insensible à la casse)
    const r = await request(app).get(`/api/search?q=${needle.toLowerCase()}`).set(auth);
    expect(r.status).toBe(200);
    expect(r.body.projects.map((p: { id: number }) => p.id)).toContain(projectId);
    expect(r.body.sequences.length).toBe(1);
    expect(r.body.shots.length).toBe(1);
    expect(r.body.tasks.length).toBe(1);

    // Artiste non membre : aucune entité de ce projet ne fuit
    const rArtist = await request(app).get(`/api/search?q=${needle}`).set('Authorization', `Bearer ${artistToken}`);
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
    const proj = await request(app).post('/api/projects').set(auth).send({ name: `IT Context ${suffix}` });
    const projectId = proj.body.project.id;
    const seq = await request(app).post('/api/sequences').set(auth).send({ projectId, name: 'Seq ctx', code: `SQ${suffix}` });
    const shot = await request(app).post('/api/shots').set(auth)
      .send({ projectId, name: 'Shot ctx', code: `CX${suffix}`, sequenceId: seq.body.sequence.id });
    const task = await request(app).post('/api/tasks').set(auth).send({ shotId: shot.body.shot.id, name: 'Task ctx', type: 'COMPOSITING' });
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
    const forbidden = await request(app).get(`/api/context/task/${task.body.task.id}`)
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
  it('notifie l\'assigné, expose le compteur non-lus, marque lu / tout lu, scope par utilisateur', async () => {
    const suffix = Date.now();
    const auth = { Authorization: `Bearer ${token}` };
    const artistAuth = { Authorization: `Bearer ${artistToken}` };

    // Projet + membership de l'artiste
    const proj = await request(app).post('/api/projects').set(auth).send({ name: `IT Notif ${suffix}` });
    const projectId = proj.body.project.id;
    await request(app).post(`/api/projects/${projectId}/members`).set(auth).send({ userId: artistId });

    // Tâche assignée à l'artiste (par l'admin) → notification pour l'artiste
    const shot = await request(app).post('/api/shots').set(auth).send({ projectId, name: 'Notif shot', code: `NF${suffix}` });
    const task = await request(app).post('/api/tasks').set(auth)
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
    expect(listAdmin.body.notifications.some(
      (n: { type: string; referenceId: number }) => n.type === 'TASK_ASSIGNED' && n.referenceId === taskId,
    )).toBe(false);

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
