// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

vi.mock('../lib/prisma', () => ({
  prisma: {
    episode: { findFirst: vi.fn() },
    sequence: { findFirst: vi.fn() },
    shot: { findFirst: vi.fn() },
    asset: { findFirst: vi.fn() },
    entityNote: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    noteTemplate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({ assertProjectManage: vi.fn() }));

import {
  createTemplate,
  deleteTemplate,
  getNote,
  listTemplates,
  setNote,
  updateTemplate,
} from './EntityNoteService';
import { prisma } from '../lib/prisma';

const actor = { id: 1, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.shot.findFirst).mockResolvedValue({ projectId: 7 } as never);
});

describe('getNote', () => {
  it("rend une fiche vide plutôt qu'absente : l'encart existe toujours à l'écran", async () => {
    vi.mocked(prisma.entityNote.findFirst).mockResolvedValue(null);
    expect(await getNote('shot', 42)).toEqual({ body: '', updatedAt: null, updatedBy: null });
  });

  it('interroge la bonne colonne de rattachement selon le type', async () => {
    vi.mocked(prisma.entityNote.findFirst).mockResolvedValue(null);
    await getNote('asset', 5);
    expect(prisma.entityNote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assetId: 5 } }),
    );
  });
});

describe('setNote', () => {
  it('crée la fiche quand il n’y en a pas', async () => {
    vi.mocked(prisma.entityNote.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.entityNote.create).mockResolvedValue({
      body: '# Brief',
      updatedAt: new Date('2026-08-25'),
      updatedBy: null,
    } as never);

    const note = await setNote(actor, 'shot', 42, '# Brief');

    expect(note.body).toBe('# Brief');
    expect(prisma.entityNote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: 7, shotId: 42 }) }),
    );
  });

  it('met à jour la fiche existante sans en créer une seconde', async () => {
    vi.mocked(prisma.entityNote.findFirst).mockResolvedValue({ id: 3 } as never);
    vi.mocked(prisma.entityNote.update).mockResolvedValue({
      body: 'nouveau',
      updatedAt: new Date(),
      updatedBy: null,
    } as never);

    await setNote(actor, 'shot', 42, 'nouveau');

    expect(prisma.entityNote.create).not.toHaveBeenCalled();
    expect(prisma.entityNote.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 } }));
  });

  it('vider la fiche la supprime — sinon l’écran afficherait un auteur sans contenu', async () => {
    vi.mocked(prisma.entityNote.findFirst).mockResolvedValue({ id: 3 } as never);

    const note = await setNote(actor, 'shot', 42, '   \n  ');

    expect(prisma.entityNote.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(note).toEqual({ body: '', updatedAt: null, updatedBy: null });
  });

  it('vider une fiche qui n’existe pas ne fait rien', async () => {
    vi.mocked(prisma.entityNote.findFirst).mockResolvedValue(null);
    await setNote(actor, 'shot', 42, '');
    expect(prisma.entityNote.delete).not.toHaveBeenCalled();
  });

  it('refuse une fiche démesurée', async () => {
    await expect(setNote(actor, 'shot', 42, 'x'.repeat(100_001))).rejects.toThrow(/too long/i);
  });

  it("refuse une entité qui n'existe pas", async () => {
    vi.mocked(prisma.shot.findFirst).mockResolvedValue(null);
    await expect(setNote(actor, 'shot', 999, 'texte')).rejects.toThrow(/not found/i);
  });
});

describe('listTemplates', () => {
  it('cumule les modèles du studio et ceux du projet', async () => {
    vi.mocked(prisma.noteTemplate.findMany).mockResolvedValue([] as never);
    await listTemplates(1, 7);
    expect(prisma.noteTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ projectId: null }, { projectId: 7 }] }),
      }),
    );
  });

  it('un périmètre précis ramène aussi les modèles « tous types »', async () => {
    vi.mocked(prisma.noteTemplate.findMany).mockResolvedValue([] as never);
    await listTemplates(1, null, 'shot');
    expect(prisma.noteTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scope: { in: ['all', 'shot'] } }),
      }),
    );
  });
});

describe('modèles — écriture', () => {
  it('refuse un modèle sans nom', async () => {
    await expect(createTemplate(1, 2, { scope: 'shot', name: '  ', body: 'x' })).rejects.toThrow(
      /needs a name/i,
    );
  });

  it('refuse un périmètre inconnu', async () => {
    // @ts-expect-error — cas d'un appelant qui contourne le schéma Zod de la route.
    await expect(createTemplate(1, 2, { scope: 'version', name: 'X', body: '' })).rejects.toThrow();
  });

  it("ne modifie pas le modèle d'un autre studio", async () => {
    vi.mocked(prisma.noteTemplate.findFirst).mockResolvedValue(null);
    await expect(updateTemplate(1, 3, { name: 'X' })).rejects.toThrow(/not found/i);
    await expect(deleteTemplate(1, 3)).rejects.toThrow(/not found/i);
  });
});
