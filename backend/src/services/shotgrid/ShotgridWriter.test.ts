// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ShotgridWriter } from './ShotgridWriter';
import type { ShotgridClient } from './ShotgridClient';

const findById = vi.fn();
const unsafeCreate = vi.fn();
const unsafeUpdate = vi.fn();
const unsafeUploadFile = vi.fn();

const SCOPE = { sgProjectId: 42, sgProjectName: 'ALPHA' };

function writer() {
  return new ShotgridWriter({
    ...SCOPE,
    client: { findById, unsafeCreate, unsafeUpdate, unsafeUploadFile } as unknown as ShotgridClient,
  });
}

/** Entité du projet lié, telle que la relecture la rend. */
const inProject = { id: 7, type: 'Shot', project: { type: 'Project', id: 42, name: 'ALPHA' } };

beforeEach(() => {
  vi.clearAllMocks();
  findById.mockResolvedValue(inProject);
  unsafeCreate.mockResolvedValue({ id: 900, type: 'Shot' });
  unsafeUpdate.mockResolvedValue({ id: 7, type: 'Shot' });
  unsafeUploadFile.mockResolvedValue(undefined);
});

describe('update', () => {
  it('écrit quand la cible est bien dans le projet lié', async () => {
    await writer().update('Shot', 7, { sg_status_list: 'ip' });

    expect(unsafeUpdate).toHaveBeenCalledWith('Shot', 7, { sg_status_list: 'ip' }, {});
  });

  /**
   * Le cas qui coûte cher : un lien pointe une entité supprimée puis recréée sous le même
   * identifiant dans un autre projet. Sans relecture, on écrit dans la production de
   * quelqu'un d'autre.
   */
  it("n'écrit pas dans une entité passée à un autre projet", async () => {
    findById.mockResolvedValue({ ...inProject, project: { type: 'Project', id: 99, name: 'BETA' } });

    await expect(writer().update('Shot', 7, { sg_status_list: 'ip' })).resolves.toBeNull();
    expect(unsafeUpdate).not.toHaveBeenCalled();
  });

  it("n'écrit pas dans un projet modèle", async () => {
    findById.mockResolvedValue({
      ...inProject,
      project: { type: 'Project', id: 42, name: 'Template Project' },
    });

    await expect(writer().update('Shot', 7, {})).resolves.toBeNull();
    expect(unsafeUpdate).not.toHaveBeenCalled();
  });

  it("n'écrit pas dans une cible que le site ne rend plus", async () => {
    findById.mockResolvedValue(null);

    await expect(writer().update('Shot', 7, {})).resolves.toBeNull();
    expect(unsafeUpdate).not.toHaveBeenCalled();
  });
});

describe('create', () => {
  it('pose le projet lié lui-même', async () => {
    await writer().create('Note', { subject: 'bonjour' });

    expect(unsafeCreate).toHaveBeenCalledWith(
      'Note',
      { subject: 'bonjour', project: { type: 'Project', id: 42 } },
      null,
    );
  });

  /**
   * Un appelant ne choisit pas le projet : c'est une erreur de programmation, pas une
   * donnée à arbitrer. On refuse avant que la moindre requête ne parte.
   */
  it('refuse une charge utile qui vise un autre projet', async () => {
    await expect(writer().create('Note', { project: { type: 'Project', id: 99 } })).rejects.toThrow();
    expect(unsafeCreate).not.toHaveBeenCalled();
  });

  it('accepte une charge utile qui répète le bon projet', async () => {
    await writer().create('Note', { project: { type: 'Project', id: 42 } });

    expect(unsafeCreate).toHaveBeenCalled();
  });

  /** C'est le site qui décide de ce qu'il a écrit — on le relit avant de s'en réjouir. */
  it('lève quand le site a déposé l’entité ailleurs', async () => {
    findById.mockResolvedValue({
      id: 900,
      type: 'Note',
      project: { type: 'Project', id: 99, name: 'BETA' },
    });

    await expect(writer().create('Note', {})).rejects.toThrow();
  });

  it('transmet le compte au nom duquel écrire', async () => {
    await writer().create('Note', {}, { asUserLogin: 'lea@studio.fr' });

    expect(unsafeCreate).toHaveBeenCalledWith('Note', expect.anything(), 'lea@studio.fr');
  });
});

describe('upload', () => {
  it('dépose le fichier après la même relecture que update', async () => {
    await expect(
      writer().upload('Version', 7, 'image', Buffer.from('x'), 'a.webp', 'image/webp'),
    ).resolves.toBe(true);
    expect(unsafeUploadFile).toHaveBeenCalled();
  });

  it('ne dépose rien sur une entité d’un autre projet', async () => {
    findById.mockResolvedValue({ ...inProject, project: { type: 'Project', id: 99 } });

    await expect(
      writer().upload('Version', 7, 'image', Buffer.from('x'), 'a.webp', 'image/webp'),
    ).resolves.toBe(false);
    expect(unsafeUploadFile).not.toHaveBeenCalled();
  });
});
