// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est remonté en tête de fichier : les doublures doivent l'être aussi.
const { comment, mediaObject, shotgridLink, links, touch } = vi.hoisted(() => ({
  comment: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  mediaObject: { findFirst: vi.fn() },
  shotgridLink: { findUnique: vi.fn() },
  links: { mapSgToLocal: vi.fn(), upsertLink: vi.fn(), findByLocal: vi.fn() },
  touch: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: { comment, mediaObject, shotgridLink } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/annotationSvg', () => ({ annotationToSvg: vi.fn(() => null) }));
vi.mock('../../config/env', () => ({ env: { APP_URL: null } }));
vi.mock('../MediaService', () => ({ mediaSourceKey: vi.fn(() => 'key') }));
vi.mock('../StorageService', () => ({ storage: {} }));
vi.mock('./ShotgridNoteAttachments', () => ({ importNoteAttachments: vi.fn(async () => 0) }));
vi.mock('./ShotgridPullService', () => ({ touch: (...args: unknown[]) => touch(...args) }));
vi.mock('./shotgridSettings', () => ({ can: () => true }));
vi.mock('./shotgridLinks', () => ({
  mapSgToLocal: (...args: unknown[]) => links.mapSgToLocal(...args),
  upsertLink: (...args: unknown[]) => links.upsertLink(...args),
  findByLocal: (...args: unknown[]) => links.findByLocal(...args),
}));

import { pullNotes } from './ShotgridNoteSync';
import type { PullContext } from './ShotgridPullService';

function contextWith(records: unknown[]) {
  const journal = { count: vi.fn(), log: vi.fn(async () => undefined) };
  const search = vi.fn(
    async (_entity: string, _options: { filters: unknown[]; maxRecords: number }) => records,
  );
  const ctx = {
    connection: { id: 1, projectId: 42, sgProjectId: 77 },
    settings: {},
    scope: { sgProjectId: 77, sgProjectName: 'ALPHA' },
    journal,
    client: { search },
  } as unknown as PullContext;
  return { ctx, journal, search };
}

const note = (id: number, projectId = 77) => ({
  type: 'Note',
  id,
  subject: 'Raccord',
  content: 'Le raccord saute',
  note_links: [{ type: 'Version', id: 900 }],
  user: { type: 'HumanUser', id: 5, name: 'Léa' },
  project: { type: 'Project', id: projectId, name: 'ALPHA' },
});

beforeEach(() => {
  vi.clearAllMocks();
  links.mapSgToLocal.mockImplementation(async (_c: number, type: string) =>
    type === 'version' ? new Map([[900, { localId: 31 }]]) : new Map(),
  );
  links.upsertLink.mockResolvedValue(undefined);
  mediaObject.findFirst.mockResolvedValue({ id: 71 });
  shotgridLink.findUnique.mockResolvedValue(null);
  comment.create.mockResolvedValue({ id: 555 });
});

/**
 * Les notes n'étaient jamais importées : l'événement Note passait par une passe qui ne
 * savait pas les lire. Maintenant qu'elle existe, elle doit rester cloisonnée au projet
 * et savoir ne relire qu'une note désignée.
 */
describe('pullNotes', () => {
  it('cumule le filtre d’identifiants avec le filtre de projet', async () => {
    const { ctx, search } = contextWith([]);
    await pullNotes(ctx, { onlySgIds: [501, 502] });

    const args = search.mock.calls[0]![1];
    expect(args.filters).toEqual([
      ['project', 'is', { type: 'Project', id: 77 }],
      ['id', 'in', [501, 502]],
    ]);
    expect(args.maxRecords).toBe(2);
  });

  it('balaie le projet quand aucune note n’est désignée', async () => {
    const { ctx, search } = contextWith([]);
    await pullNotes(ctx);

    const args = search.mock.calls[0]![1];
    expect(args.filters).toEqual([['project', 'is', { type: 'Project', id: 77 }]]);
    expect(args.maxRecords).toBe(500);
  });

  it('écarte une note venue d’un autre projet du site', async () => {
    // Le filtre part avec la requête, mais c'est la revérification qui fait rempart.
    const { ctx, journal } = contextWith([note(501, 78)]);
    await pullNotes(ctx, { onlySgIds: [501] });

    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
    expect(comment.create).not.toHaveBeenCalled();
  });

  it('crée le commentaire et le compte dans le résumé de fin de passe', async () => {
    const { ctx, journal } = contextWith([note(501)]);
    await pullNotes(ctx, { onlySgIds: [501] });

    expect(comment.create).toHaveBeenCalledTimes(1);
    const created = comment.create.mock.calls[0]![0] as { data: { mediaObjectId: number } };
    expect(created.data.mediaObjectId).toBe(71);
    expect(touch).toHaveBeenCalledWith(ctx, 'comment', 555);
    expect(journal.count).toHaveBeenCalledWith('notes', 'created');
  });

  it('ignore une note née dans ReView', async () => {
    // Elle reviendrait en double de son propre commentaire.
    const { ctx } = contextWith([{ ...note(501), content: 'Retour\n[ReView] Admin' }]);
    await pullNotes(ctx, { onlySgIds: [501] });
    expect(comment.create).not.toHaveBeenCalled();
  });
});
