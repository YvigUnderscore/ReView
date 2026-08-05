// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

/**
 * Tests d'intégration de l'API v1 (nécessitent Postgres/Redis/MinIO).
 *
 * On y vérifie ce qui distingue cette API : l'adressage par chemin, l'idempotence des
 * créations, le cantonnement d'un token à un projet, et la publication en deux appels.
 * Aucun octet n'est déposé sur le stockage : la publication s'arrête à l'URL présignée,
 * ce qui suffit à valider la chaîne côté serveur.
 */
const app = createApp();

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

describe('v1 — découverte', () => {
  it('expose son index sans authentification préalable du contenu', async () => {
    const r = await request(app).get('/api/v1').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.version).toBe('v1');
    expect(r.body.capabilities.pathResolution).toBe(true);
  });

  it('refuse un appel non authentifié', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
  });

  it('décrit les pouvoirs du porteur', async () => {
    const r = await request(app).get('/api/v1/me').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.auth.kind).toBe('session');
    expect(r.body.projects).toBe('all');
  });

  it('publie les énumérations et le catalogue d’événements', async () => {
    const r = await request(app).get('/api/v1/schema').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.enums.taskStatus).toContain('IN_PROGRESS');
    expect(r.body.events).toContain('version.published');
    expect(r.body.scopes).toContain('versions:write');
  });
});

describe('v1 — création idempotente et résolution par chemin', () => {
  it('crée la hiérarchie puis la retrouve sans doublon', async () => {
    const seq = await request(app)
      .post(`/api/v1/projects/${projectCode}/sequences`)
      .set(auth(adminToken))
      .send({ code: 'SQ010' });
    expect(seq.status).toBe(201);
    expect(seq.body.created).toBe(true);

    // Rejeu : même appel, aucune création, statut 200 plutôt que 201.
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
    // Le type est déduit du nom quand il n'est pas fourni.
    expect(task.body.task.type).toBe('ANIMATION');
  });

  it('résout un chemin complet en entités', async () => {
    const r = await request(app)
      .get('/api/v1/resolve')
      .query({ path: `${projectCode}/SQ010/SH0100/anim` })
      .set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('task');
    expect(r.body.shot.code).toBe('SH0100');
    expect(r.body.task.name).toBe('anim');
  });

  it('résout sans tenir compte de la casse', async () => {
    const r = await request(app)
      .get('/api/v1/resolve')
      .query({ path: `${projectCode}/sq010/sh0100` })
      .set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.shot.code).toBe('SH0100');
  });

  it('nomme le segment introuvable', async () => {
    const r = await request(app)
      .get('/api/v1/resolve')
      .query({ path: `${projectCode}/SQ010/SH9999` })
      .set(auth(adminToken));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('SHOT_NOT_FOUND');
  });
});

describe('v1 — publication depuis un DCC', () => {
  // Ces cas s'arrêtent avant le dépôt du fichier : les médias restent en UPLOADING et
  // butent sur le plafond d'uploads simultanés (5). On repart d'une ardoise propre.
  beforeEach(async () => {
    await prisma.mediaObject.deleteMany({ where: { status: 'UPLOADING' } });
  });

  it('ouvre une publication et renvoie une URL d’envoi', async () => {
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

  it('numérote la version suivante sans écraser la précédente', async () => {
    const r = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .send({ path: `${projectCode}/SQ010/SH0100/anim`, filename: 'SH0100_anim_v002.mov' });
    expect(r.status).toBe(201);
    expect(r.body.version.name).toBe('V02');
  });

  it('crée les maillons manquants du chemin en une fois', async () => {
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

  it('refuse un chemin trop court pour désigner une cible', async () => {
    const r = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .send({ path: projectCode, filename: 'x.mov' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PATH_TOO_SHALLOW');
  });

  it('refuse un fichier dont le type est indéterminable', async () => {
    const r = await request(app)
      .post('/api/v1/publish')
      .set(auth(adminToken))
      .send({ path: `${projectCode}/SQ010/SH0100/anim`, filename: 'notes.txt' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('KIND_UNKNOWN');
  });

  it('rejoue une requête portant la même clé d’idempotence sans rien recréer', async () => {
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

    // Sans la clé, le même appel se heurte à la version déjà existante.
    const conflict = await request(app).post('/api/v1/publish').set(auth(adminToken)).send(body);
    expect(conflict.status).toBe(400);
    expect(conflict.body.code).toBe('VERSION_EXISTS');
  });
});

describe('v1 — tokens d’API et scopes', () => {
  it('cantonne un token de service à son projet et à ses scopes', async () => {
    const project = await prisma.project.findFirst({ where: { slug: projectCode } });
    const other = await request(app)
      .post('/api/projects')
      .set(auth(adminToken))
      .send({ name: `V1 Autre ${suffix}` });

    // Rôle SUPERVISOR délibéré : son accès aux projets est global, donc seul le
    // cantonnement du token peut lui barrer l'autre projet. C'est lui qu'on teste.
    const created = await request(app)
      .post('/api/admin/service-tokens')
      .set(auth(adminToken))
      .send({
        name: `Ferme ${suffix}`,
        scopes: ['projects:read', 'shots:read'],
        role: 'SUPERVISOR',
        projectId: project!.id,
      });
    expect(created.status).toBe(201);
    const token: string = created.body.token;
    expect(token.startsWith('rvk_')).toBe(true);

    // Le scope accordé fonctionne…
    const shots = await request(app).get(`/api/v1/projects/${projectCode}/shots`).set(auth(token));
    expect(shots.status).toBe(200);

    // …celui qui ne l'est pas est refusé, avec le scope manquant nommé.
    const versions = await request(app).get(`/api/v1/projects/${projectCode}/versions`).set(auth(token));
    expect(versions.status).toBe(403);
    expect(versions.body.code).toBe('SCOPE_REQUIRED');

    // Le cantonnement prime sur tout : l'autre projet reste hors de portée.
    const foreign = await request(app).get(`/api/v1/projects/${other.body.project.slug}`).set(auth(token));
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('TOKEN_PROJECT_SCOPE');

    // La liste des projets est réduite au seul projet du token.
    const list = await request(app).get('/api/v1/projects').set(auth(token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].code).toBe(projectCode);
  });

  it('n’expose pas les comptes de service dans l’annuaire', async () => {
    const users = await request(app).get('/api/users').set(auth(adminToken));
    expect(users.status).toBe(200);
    const emails: string[] = users.body.users.map((u: { email: string }) => u.email);
    expect(emails.some((e) => e.includes('service.review.invalid'))).toBe(false);
  });

  it('interdit la connexion interactive d’un compte de service', async () => {
    const svc = await prisma.user.findFirst({ where: { isService: true } });
    expect(svc).not.toBeNull();
    const r = await request(app).post('/api/auth/login').send({ email: svc!.email, password: 'admin1234' });
    expect(r.status).toBe(401);
  });
});

describe('v1 — journal d’événements', () => {
  it('démarre au présent puis délivre les événements suivants', async () => {
    const first = await request(app).get('/api/v1/events').set(auth(adminToken));
    expect(first.status).toBe(200);
    expect(first.body.events).toEqual([]);
    const cursor: number = first.body.cursor;

    // Un événement métier alimente le journal.
    const shot = await request(app)
      .post(`/api/v1/projects/${projectCode}/shots`)
      .set(auth(adminToken))
      .send({ code: `SH${suffix.slice(-4)}` });
    await request(app)
      .post(`/api/v1/shots/${shot.body.shot.id}/tasks`)
      .set(auth(adminToken))
      .send({ name: 'comp' });

    // La journalisation est asynchrone : on laisse le temps à l'écriture d'aboutir.
    await new Promise((r) => setTimeout(r, 500));

    const next = await request(app).get('/api/v1/events').query({ since: cursor }).set(auth(adminToken));
    expect(next.status).toBe(200);
    expect(next.body.events.length).toBeGreaterThan(0);
    expect(next.body.events.map((e: { event: string }) => e.event)).toContain('task.created');
    expect(next.body.cursor).toBeGreaterThan(cursor);
  });
});
