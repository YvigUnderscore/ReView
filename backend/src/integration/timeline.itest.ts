// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MediaKind, MediaStatus, TaskType, VersionStatus } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

/**
 * Montage automatique et espace asset (Phase 45) — intégration.
 *
 * Le jeu d'essai reproduit la situation qui a motivé la fonctionnalité : un plan publié
 * à deux étapes du pipe (la plus récente n'étant pas la plus avancée), un plan à une
 * seule étape, un plan sans rien, et un plan coupé au montage.
 */
const app = createApp();
let token = '';
let projectId = 0;
let sequenceId = 0;
let assetId = 0;
const shots: Record<string, number> = {};

const login = async () => {
  for (const email of ['admin@review.local', 'ci-admin@review.local']) {
    const r = await request(app).post('/api/auth/login').send({ email, password: 'admin1234' });
    if (r.status === 200) return r.body.token as string;
  }
  throw new Error('aucun compte administrateur de test disponible');
};

/** Crée une tâche, sa version publiée et un média visible, à l'étape voulue. */
async function publish(parent: { shotId?: number; assetId?: number }, department: string, name: string) {
  const type = department === 'ANIMATION' ? TaskType.ANIMATION : TaskType.COMPOSITING;
  const task = await prisma.task.create({
    data: { ...parent, name: department.toLowerCase(), type, department },
  });
  const version = await prisma.version.create({
    data: { taskId: task.id, name, status: VersionStatus.PUBLISHED, published: true },
  });
  await prisma.mediaObject.create({
    data: {
      versionId: version.id,
      kind: MediaKind.VIDEO,
      originalName: `${name}.mp4`,
      storageKey: `itest/${version.id}.mp4`,
      mimeType: 'video/mp4',
      status: MediaStatus.READY,
      published: true,
      metadata: { duration: 2 },
    },
  });
  return version.id;
}

beforeAll(async () => {
  token = await login();
  const studio = await prisma.studio.findFirstOrThrow();
  const suffix = Date.now();
  const project = await prisma.project.create({
    data: { studioId: studio.id, name: `itest-timeline-${suffix}`, slug: `itest-timeline-${suffix}` },
  });
  projectId = project.id;
  const sequence = await prisma.sequence.create({
    data: { projectId, code: 'SQ010', name: 'Séquence', order: 0 },
  });
  sequenceId = sequence.id;

  const makeShot = async (code: string, order: number, omitted = false, frames?: [number, number]) => {
    const shot = await prisma.shot.create({
      data: {
        projectId,
        sequenceId,
        code,
        name: code,
        order,
        omitted,
        startFrame: frames?.[0] ?? null,
        endFrame: frames?.[1] ?? null,
      },
    });
    shots[code] = shot.id;
    return shot.id;
  };

  await makeShot('SH010', 0);
  await makeShot('SH020', 10);
  await makeShot('SH030', 20, false, [1001, 1048]);
  await makeShot('SH040', 30, true);

  // SH010 : compositing d'abord, animation ENSUITE — la plus récente n'est pas la plus avancée.
  await publish({ shotId: shots.SH010 }, 'COMPOSITING', 'v0001');
  await publish({ shotId: shots.SH010 }, 'ANIMATION', 'v0009');
  await publish({ shotId: shots.SH020 }, 'ANIMATION', 'v0002');
  await publish({ shotId: shots.SH040 }, 'ANIMATION', 'v0003');

  const asset = await prisma.asset.create({ data: { projectId, name: `itest-asset-${suffix}` } });
  assetId = asset.id;
  await publish({ assetId }, 'COMPOSITING', 'v0004');
});

afterAll(async () => {
  if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('montage automatique', () => {
  it('résout le montage d’une séquence au premier accès, sans création explicite', async () => {
    const r = await request(app)
      .get(`/api/timelines?projectId=${projectId}&sequenceId=${sequenceId}`)
      .set(auth());
    expect(r.status).toBe(200);
    expect(r.body.timeline.id).toBeGreaterThan(0);
    // Jamais renommé : le nom reste nul et l'interface affiche son libellé traduit.
    expect(r.body.timeline.name).toBeNull();
  });

  it('retient l’étape la plus avancée, pas la version la plus récente', async () => {
    const r = await request(app)
      .get(`/api/timelines?projectId=${projectId}&sequenceId=${sequenceId}`)
      .set(auth());
    const clip = r.body.timeline.items.find((it: { shotCode: string }) => it.shotCode === 'SH010');
    expect(clip.versionName).toBe('v0001');
    expect(clip.department).toBe('COMPOSITING');
  });

  it('tient la place des plans sans média et saute les plans omis', async () => {
    const r = await request(app)
      .get(`/api/timelines?projectId=${projectId}&sequenceId=${sequenceId}`)
      .set(auth());
    const codes = r.body.timeline.items.map((it: { shotCode: string }) => it.shotCode);
    expect(codes).toEqual(['SH010', 'SH020', 'SH030']);
    const gap = r.body.timeline.items[2];
    expect(gap.placeholder).toBe(true);
    expect(gap.duration).toBe(2); // 48 frames à 24 i/s
    expect(r.body.timeline.gapCount).toBe(1);
    expect(r.body.timeline.totalDuration).toBe(6);
  });

  it('cible une étape précise et retombe en amont au besoin', async () => {
    const list = await request(app)
      .get(`/api/timelines?projectId=${projectId}&sequenceId=${sequenceId}`)
      .set(auth());
    const id = list.body.timeline.id;
    const r = await request(app)
      .patch(`/api/timelines/${id}`)
      .set(auth())
      .send({ department: 'ANIMATION', name: 'Montage test' });
    expect(r.status).toBe(200);
    const clip = r.body.timeline.items.find((it: { shotCode: string }) => it.shotCode === 'SH010');
    expect(clip.versionName).toBe('v0009');
    expect(r.body.timeline.name).toBe('Montage test');
  });

  it('fige une révision puis rend l’écart avec la précédente', async () => {
    const list = await request(app)
      .get(`/api/timelines?projectId=${projectId}&sequenceId=${sequenceId}`)
      .set(auth());
    const id = list.body.timeline.id;
    const first = await request(app).post(`/api/timelines/${id}/snapshots`).set(auth()).send({});
    expect(first.status).toBe(201);
    expect(first.body.snapshot.items).toHaveLength(3);

    await request(app).patch(`/api/timelines/${id}`).set(auth()).send({ department: null });
    const second = await request(app).post(`/api/timelines/${id}/snapshots`).set(auth()).send({});
    const revision = second.body.snapshot.revision;

    const diff = await request(app).get(`/api/timelines/${id}/snapshots/${revision}`).set(auth());
    expect(diff.body.diff.changed).toEqual([{ shotCode: 'SH010', from: 'v0009', to: 'v0001' }]);
    expect(diff.body.diff.added).toEqual([]);
    expect(diff.body.diff.removed).toEqual([]);
  });

  it('enchaîne toutes les séquences dans le montage du projet', async () => {
    const r = await request(app).get(`/api/timelines?projectId=${projectId}`).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.timeline.sequenceId).toBeNull();
    expect(r.body.timeline.items).toHaveLength(3);
  });

  it('refuse un montage d’un projet auquel on n’a pas accès', async () => {
    const r = await request(app).get(`/api/timelines?projectId=${projectId}`);
    expect(r.status).toBe(401);
  });
});

describe('espace asset', () => {
  it('remonte les versions publiées SOUS une tâche, invisibles auparavant', async () => {
    const r = await request(app).get(`/api/assets/${assetId}/tree`).set(auth());
    expect(r.status).toBe(200);
    const group = r.body.groups.find((g: { key: string | null }) => g.key === 'COMPOSITING');
    expect(group.items[0].versions[0].name).toBe('v0004');
  });

  it('désigne la version la plus avancée comme dernière version', async () => {
    const r = await request(app).get(`/api/assets/${assetId}/latest`).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.latest.versionName).toBe('v0004');
    expect(r.body.latest.department).toBe('COMPOSITING');
  });

  it('répond 404 sur un asset sans version publiée', async () => {
    const empty = await prisma.asset.create({ data: { projectId, name: `vide-${Date.now()}` } });
    const r = await request(app).get(`/api/assets/${empty.id}/latest`).set(auth());
    expect(r.status).toBe(404);
  });
});
