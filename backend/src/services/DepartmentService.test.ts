// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    department: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    project: { findUnique: vi.fn() },
    asset: { update: vi.fn(), findUnique: vi.fn() },
    shot: { update: vi.fn(), findUnique: vi.fn() },
    sequence: { update: vi.fn(), findUnique: vi.fn() },
    user: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import {
  attachHolderDepartments,
  create,
  detachHolderDepartments,
  listForProject,
  normaliseKey,
  remove,
  resolveByKey,
  setHolderDepartments,
  setUserDepartments,
  syncFromSettings,
  update,
} from './DepartmentService';
import { prisma } from '../lib/prisma';

const dept = (over: Record<string, unknown> = {}) => ({
  id: 1,
  studioId: 1,
  projectId: null,
  key: 'ANIMATION',
  name: 'Animation',
  order: 0,
  color: null,
  deletedAt: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('normaliseKey', () => {
  it('met en capitales et remplace la ponctuation', () => {
    expect(normaliseKey('Look Dev')).toBe('LOOK_DEV');
    expect(normaliseKey('  fx  ')).toBe('FX');
    expect(normaliseKey('Matte-Painting')).toBe('MATTE_PAINTING');
  });

  it('ne laisse ni tiret bas en tête ni en queue', () => {
    expect(normaliseKey('  --anim--  ')).toBe('ANIM');
  });

  it('rend une chaîne vide pour une saisie sans caractère utile', () => {
    expect(normaliseKey('   ')).toBe('');
    expect(normaliseKey('---')).toBe('');
  });

  it('borne la longueur', () => {
    expect(normaliseKey('a'.repeat(80))).toHaveLength(40);
  });
});

describe('listForProject', () => {
  it('rend les départements du projet quand il en a', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept({ projectId: 7 })] as never);
    const list = await listForProject(7);
    expect(list).toHaveLength(1);
    // Le studio n'est même pas consulté : la liste du projet remplace la sienne.
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('retombe sur le référentiel du studio quand le projet n’en redéfinit pas', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 3 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    const list = await listForProject(7);
    expect(list).toEqual([dept()]);
    expect(prisma.department.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { studioId: 3, projectId: null, deletedAt: null } }),
    );
  });

  it('rend une liste vide pour un projet inexistant', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);
    expect(await listForProject(999)).toEqual([]);
  });
});

describe('create', () => {
  it('dérive la clé du nom et la range en fin de liste', async () => {
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce({ order: 4 } as never);
    vi.mocked(prisma.department.create).mockResolvedValueOnce(dept() as never);
    await create(1, null, { name: 'Look Dev' });
    expect(prisma.department.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ key: 'LOOK_DEV', name: 'Look Dev', order: 5 }),
      }),
    );
  });

  it('refuse un nom vide', async () => {
    await expect(create(1, null, { name: '   ' })).rejects.toThrow();
  });

  it('refuse une clé déjà prise', async () => {
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(dept() as never);
    await expect(create(1, null, { name: 'Animation' })).rejects.toThrow();
  });

  it('ressuscite un département retiré plutôt que d’en créer un doublon', async () => {
    // La clé doit rester la même, sinon les tâches d'avant ne se retrouvent pas.
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(
      dept({ id: 12, deletedAt: new Date() }) as never,
    );
    vi.mocked(prisma.department.update).mockResolvedValueOnce(dept({ id: 12 }) as never);
    await create(1, null, { name: 'Animation' });
    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.department.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12 }, data: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});

describe('update', () => {
  it('ne touche jamais à la clé', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValueOnce(dept() as never);
    vi.mocked(prisma.department.update).mockResolvedValueOnce(dept() as never);
    await update(1, { name: 'Anim', key: 'AUTRE_CHOSE' });
    const data = vi.mocked(prisma.department.update).mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('key');
    expect(data.name).toBe('Anim');
  });

  it('refuse un département inexistant', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValueOnce(null);
    await expect(update(404, { name: 'x' })).rejects.toThrow();
  });
});

describe('remove', () => {
  it('retire logiquement, sans effacer le travail rattaché', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValueOnce(dept() as never);
    vi.mocked(prisma.department.update).mockResolvedValueOnce(dept() as never);
    await remove(1);
    const data = vi.mocked(prisma.department.update).mock.calls[0]![0].data as { deletedAt: Date };
    expect(data.deletedAt).toBeInstanceOf(Date);
  });
});

describe('resolveByKey', () => {
  it('trouve un département existant sans tenir compte de la casse', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    const found = await resolveByKey(7, 'animation');
    expect(found?.id).toBe(1);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it('crée l’étape inconnue plutôt que de la perdre — cas d’un step ShotGrid', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.department.create).mockResolvedValueOnce(dept({ id: 9, key: 'GROOM' }) as never);
    const found = await resolveByKey(7, 'Groom');
    expect(found?.key).toBe('GROOM');
    expect(prisma.department.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: 7 }) }),
    );
  });

  it('ignore une clé vide', async () => {
    expect(await resolveByKey(7, '   ')).toBeNull();
    expect(prisma.department.findMany).not.toHaveBeenCalled();
  });
});

describe('syncFromSettings', () => {
  it('n’écrit rien quand la liste est identique à celle héritée du studio', async () => {
    // Sinon le projet cesserait d'hériter et ne suivrait plus les évolutions du studio.
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    await syncFromSettings(7, [{ key: 'ANIMATION', name: 'Animation' }]);
    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.department.update).not.toHaveBeenCalled();
  });

  it('crée les étapes manquantes dans l’ordre de la liste', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never); // hérité
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never); // propres
    vi.mocked(prisma.department.create).mockResolvedValue(dept({ id: 30 }) as never);
    await syncFromSettings(7, [
      { key: 'Layout', name: 'Layout' },
      { key: 'ANIMATION', name: 'Animation' },
    ]);
    expect(prisma.department.create).toHaveBeenCalledTimes(2);
    const first = vi.mocked(prisma.department.create).mock.calls[0]![0].data as Record<string, unknown>;
    expect(first).toMatchObject({ key: 'LAYOUT', order: 0, projectId: 7 });
  });

  it('renomme et réordonne sans toucher à la clé', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([
      dept({ id: 5, projectId: 7, key: 'ANIM', name: 'Anim', order: 3 }),
    ] as never);
    await syncFromSettings(7, [{ key: 'ANIM', name: 'Animation' }]);
    expect(prisma.department.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ name: 'Animation', order: 0, deletedAt: null }),
      }),
    );
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it('retire logiquement ce qui a disparu de la liste', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([
      dept({ id: 5, projectId: 7, key: 'ANIM' }),
      dept({ id: 6, projectId: 7, key: 'FX' }),
    ] as never);
    await syncFromSettings(7, [{ key: 'ANIM', name: 'Anim' }]);
    expect(prisma.department.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [6] } } }),
    );
  });

  it('ignore une entrée sans clé exploitable', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    await syncFromSettings(7, [{ key: '  ', name: '  ' }]);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it('ne fait rien pour un projet inexistant', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);
    await syncFromSettings(999, [{ key: 'FX', name: 'FX' }]);
    expect(prisma.department.findMany).not.toHaveBeenCalled();
  });
});

describe('rattachements', () => {
  /**
   * Le rattachement contrôle désormais que chaque département appartient bien au projet
   * de l'entité : rien ne l'empêchait auparavant de poser l'étape d'un projet voisin.
   */
  const inProject = (ids: number[]) => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.shot.findUnique).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ studioId: 1 } as never);
    // Le contrôle accepte les étapes du projet ET celles du studio : une tâche vit
    // souvent dans une étape studio, la refuser interdirait de l'assigner.
    vi.mocked(prisma.department.findMany).mockResolvedValue(ids.map((id) => ({ id })) as never);
  };

  it('remplace la liste d’une entité, sans delta', async () => {
    inProject([1, 2]);
    await setHolderDepartments('asset', 5, [1, 2]);
    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { departments: { set: [{ id: 1 }, { id: 2 }] } },
    });
  });

  it('vide la liste quand on n’envoie rien', async () => {
    inProject([]);
    await setHolderDepartments('shot', 5, []);
    expect(prisma.shot.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { departments: { set: [] } },
    });
  });

  it('sait viser une séquence', async () => {
    inProject([3]);
    await setHolderDepartments('sequence', 8, [3]);
    expect(prisma.sequence.update).toHaveBeenCalled();
  });

  it('refuse le département d’un autre projet', async () => {
    // Le contrôle qui manquait : un identifiant pris ailleurs se posait sans broncher.
    inProject([1]);
    await expect(setHolderDepartments('asset', 5, [99])).rejects.toMatchObject({
      code: 'BAD_DEPARTMENT',
    });
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('ajoute et retire sans réécrire toute la liste', async () => {
    inProject([1, 2]);
    await attachHolderDepartments('asset', 5, [2]);
    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { departments: { connect: [{ id: 2 }] } },
    });
    await detachHolderDepartments('asset', 5, [2]);
    expect(prisma.asset.update).toHaveBeenLastCalledWith({
      where: { id: 5 },
      data: { departments: { disconnect: [{ id: 2 }] } },
    });
  });

  it('règle les départements d’une personne', async () => {
    await setUserDepartments(4, [1]);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { departments: { set: [{ id: 1 }] } },
    });
  });
});
