// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// L'import ShotGrid n'écrivait que la chaîne `department` : sur un projet piloté depuis le
// site, TOUTES les tâches avaient `departmentId = null`.
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('./ShotgridClient', () => ({ clientForSiteRecord: vi.fn() }));
vi.mock('../JobService', () => ({ shotgridQueue: { add: vi.fn() } }));
vi.mock('../StorageService', () => ({ storage: {}, StorageService: {} }));
vi.mock('../DepartmentService', () => ({ resolveForTask: vi.fn() }));

import { departmentResolver } from './ShotgridPullService';
import { resolveForTask } from '../DepartmentService';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveForTask).mockResolvedValue({ department: 'ANIMATION', departmentId: 4 });
});

describe('departmentResolver', () => {
  it('rend la clé ET la relation pour une étape du site', async () => {
    expect(await departmentResolver(7)('Animation')).toEqual({
      department: 'ANIMATION',
      departmentId: 4,
    });
    expect(resolveForTask).toHaveBeenCalledWith(7, 'Animation');
  });

  it('ne résout chaque étape qu’une fois par passe', async () => {
    // Un projet compte des milliers de tâches pour une dizaine d'étapes : sans mémoire, la
    // synchronisation ferait un aller-retour en base par tâche.
    const resolve = departmentResolver(7);
    await resolve('Animation');
    await resolve('animation');
    await resolve(' Animation ');
    expect(resolveForTask).toHaveBeenCalledTimes(1);
  });

  it('rend un couple vide pour une tâche sans étape', async () => {
    const resolve = departmentResolver(7);
    expect(await resolve(null)).toEqual({ department: null, departmentId: null });
    expect(await resolve('   ')).toEqual({ department: null, departmentId: null });
    expect(resolveForTask).not.toHaveBeenCalled();
  });

  it('garde sa mémoire par passe : deux synchronisations relisent la base', async () => {
    await departmentResolver(7)('Animation');
    await departmentResolver(7)('Animation');
    expect(resolveForTask).toHaveBeenCalledTimes(2);
  });
});
