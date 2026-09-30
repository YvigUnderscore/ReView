// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les invariants de sûreté du connecteur, appliqués à l'entité Episode : le filtre de
 * projet part avec la requête, et l'entité reçue est revérifiée à l'arrivée. Un site
 * héberge tous les projets du studio — écrire dans le mauvais ne se rattrape pas.
 */

const { db } = vi.hoisted(() => ({
  db: {
    project: { findUnique: vi.fn() },
    shotgridConnection: { findUnique: vi.fn() },
    shotgridLink: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    episode: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    sequence: { updateMany: vi.fn() },
  },
}));

vi.mock('../../lib/prisma', () => ({ prisma: db }));

import {
  assertEpisodeCreationAllowed,
  episodeCode,
  linkSequencesToEpisodes,
  pullEpisodes,
  pullSequenceEpisodes,
  type EpisodePullContext,
} from './ShotgridEpisodes';

const journal = {
  count: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  conflict: vi.fn().mockResolvedValue(undefined),
};

const makeCtx = (records: Record<string, unknown>[]): EpisodePullContext =>
  ({
    connection: {
      id: 1,
      projectId: 7,
      sgProjectId: 99,
      sgProjectName: 'SERIE',
      site: { baseUrl: 'https://studio.shotgrid.autodesk.com' },
    },
    client: { search: vi.fn().mockResolvedValue(records), findById: vi.fn() },
    settings: { domains: { hierarchy: { read: true, write: true } } },
    journal,
    scope: { sgProjectId: 99, sgProjectName: 'SERIE' },
  }) as unknown as EpisodePullContext;

const inProject = (over: Record<string, unknown> = {}) => ({
  id: 500,
  type: 'Episode',
  code: 'EP101',
  project: { id: 99, type: 'Project' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findUnique.mockResolvedValue({ episodesEnabled: true });
  db.shotgridLink.findMany.mockResolvedValue([]);
  db.shotgridLink.findFirst.mockResolvedValue(null);
  db.episode.findUnique.mockResolvedValue(null);
  db.episode.create.mockResolvedValue({ id: 11 });
  db.episode.update.mockResolvedValue({ id: 11 });
});

describe('episodeCode', () => {
  it('retombe sur un code stable quand le site n’en donne pas', () => {
    expect(episodeCode({ id: 42, type: 'Episode' })).toBe('EP42');
    expect(episodeCode({ id: 42, type: 'Episode', code: 'EP101' })).toBe('EP101');
  });
});

describe('assertEpisodeCreationAllowed', () => {
  it('laisse créer quand le projet n’est relié à aucun site', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    await expect(assertEpisodeCreationAllowed(7)).resolves.toBeUndefined();
  });

  it('renvoie vers le formulaire Episode du site, pas vers celui d’une Sequence', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue({
      active: true,
      settings: {},
      sgProjectId: 99,
      sgProjectName: 'SERIE',
      site: { baseUrl: 'https://studio.shotgrid.autodesk.com' },
    });
    await expect(assertEpisodeCreationAllowed(7)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SHOTGRID_LOCKED',
      sgCreateUrl: 'https://studio.shotgrid.autodesk.com/new/Episode?project=99',
    });
  });
});

describe('pullEpisodes', () => {
  it('ne lit rien tant que le niveau est éteint côté ReView', async () => {
    // Importer dans un projet qui ne montre pas le niveau créerait des lignes que
    // personne ne peut ni voir ni corriger.
    db.project.findUnique.mockResolvedValue({ episodesEnabled: false });
    const ctx = makeCtx([inProject()]);
    await pullEpisodes(ctx);
    expect(ctx.client.search).not.toHaveBeenCalled();
    expect(db.episode.create).not.toHaveBeenCalled();
  });

  it('ne lit rien quand le domaine hierarchy est fermé en lecture', async () => {
    const ctx = makeCtx([]);
    (ctx.settings as unknown as { domains: Record<string, unknown> }).domains = {
      hierarchy: { read: false, write: false },
    };
    await pullEpisodes(ctx);
    expect(ctx.client.search).not.toHaveBeenCalled();
  });

  it('joint le filtre de projet à la requête', async () => {
    const ctx = makeCtx([]);
    await pullEpisodes(ctx);
    expect(ctx.client.search).toHaveBeenCalledWith(
      'Episode',
      expect.objectContaining({
        filters: [['project', 'is', { type: 'Project', id: 99 }]],
      }),
    );
  });

  it('écarte une entité d’un autre projet et le crie au journal', async () => {
    const ctx = makeCtx([inProject({ project: { id: 1234, type: 'Project' } })]);
    await pullEpisodes(ctx);
    expect(db.episode.create).not.toHaveBeenCalled();
    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
    expect(journal.log).toHaveBeenCalledWith(
      'error',
      'shotgrid.log.wrongProject',
      expect.objectContaining({ expected: 99, found: 1234 }),
      expect.anything(),
    );
  });

  it('crée l’épisode et pose la correspondance', async () => {
    const ctx = makeCtx([inProject({ updated_at: '2026-08-01T10:00:00Z' })]);
    await pullEpisodes(ctx);
    expect(db.episode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'EP101', name: 'EP101', projectId: 7, order: 0 }),
    });
    expect(db.shotgridLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId_sgType_sgId: { connectionId: 1, sgType: 'Episode', sgId: 500 } },
      }),
    );
    expect(journal.count).toHaveBeenCalledWith('episodes', 'created');
  });

  it('ne renumérote pas l’ordre sur une relecture ciblée', async () => {
    // Sinon le traitement d'un seul événement remonterait l'épisode en tête de liste.
    const ctx = makeCtx([]);
    (ctx.client.findById as ReturnType<typeof vi.fn>).mockResolvedValue(inProject());
    await pullEpisodes(ctx, new Map(), { onlySgIds: [{ sgType: 'Episode', sgId: 500 }] });
    const data = db.episode.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.data.order).toBeUndefined();
  });
});

describe('linkSequencesToEpisodes', () => {
  const sequenceLinks = new Map([[300, { localId: 30 } as never]]);

  it('laisse la séquence détachée quand son épisode distant n’est pas lié', async () => {
    db.sequence.updateMany.mockResolvedValue({ count: 1 });
    const ctx = makeCtx([]);
    await linkSequencesToEpisodes(
      ctx,
      [{ id: 300, type: 'Sequence', sg_episode: { id: 777, type: 'Episode' } }],
      sequenceLinks,
    );
    expect(db.sequence.updateMany).toHaveBeenCalledWith({
      where: { id: 30, projectId: 7 },
      data: { episodeId: null },
    });
  });

  it('rattache quand les deux côtés sont liés, en bornant au projet', async () => {
    db.shotgridLink.findMany.mockResolvedValue([
      { sgId: 777, localId: 11, localType: 'episode', sgType: 'Episode' },
    ]);
    db.sequence.updateMany.mockResolvedValue({ count: 1 });
    const ctx = makeCtx([]);
    const updated = await linkSequencesToEpisodes(
      ctx,
      [{ id: 300, type: 'Sequence', sg_episode: { id: 777, type: 'Episode' } }],
      sequenceLinks,
    );
    expect(updated).toBe(1);
    expect(db.sequence.updateMany).toHaveBeenCalledWith({
      where: { id: 30, projectId: 7 },
      data: { episodeId: 11 },
    });
  });

  it('ignore une séquence qui n’a pas de contrepartie locale', async () => {
    const ctx = makeCtx([]);
    await linkSequencesToEpisodes(ctx, [{ id: 999, type: 'Sequence' }], sequenceLinks);
    expect(db.sequence.updateMany).not.toHaveBeenCalled();
  });
});

describe('pullSequenceEpisodes', () => {
  it('ne demande pas `sg_episode` au site tant que le niveau est éteint', async () => {
    // Un studio sans série n'a pas forcément ce champ : le réclamer ferait échouer la
    // synchronisation de tout le monde pour un niveau que personne n'a activé.
    db.project.findUnique.mockResolvedValue({ episodesEnabled: false });
    const ctx = makeCtx([]);
    expect(await pullSequenceEpisodes(ctx)).toBe(0);
    expect(ctx.client.search).not.toHaveBeenCalled();
  });

  it('interroge les séquences du projet lié sur le seul champ d’épisode', async () => {
    const ctx = makeCtx([]);
    await pullSequenceEpisodes(ctx);
    expect(ctx.client.search).toHaveBeenCalledWith(
      'Sequence',
      expect.objectContaining({
        fields: ['project', 'updated_at', 'sg_episode'],
        filters: [['project', 'is', { type: 'Project', id: 99 }]],
      }),
    );
  });

  it('écarte une séquence d’un autre projet avant toute écriture', async () => {
    const ctx = makeCtx([
      { id: 300, type: 'Sequence', project: { id: 1234, type: 'Project' }, sg_episode: null },
    ]);
    expect(await pullSequenceEpisodes(ctx)).toBe(0);
    expect(db.sequence.updateMany).not.toHaveBeenCalled();
    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
  });
});
