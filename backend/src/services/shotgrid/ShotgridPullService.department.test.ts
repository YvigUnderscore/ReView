// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The ShotGrid import only wrote the `department` string: on a project driven from the site, ALL tasks had `departmentId = null`.
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
  it('returns both the key AND the relation for a site step', async () => {
    expect(await departmentResolver(7)('Animation')).toEqual({
      department: 'ANIMATION',
      departmentId: 4,
    });
    expect(resolveForTask).toHaveBeenCalledWith(7, 'Animation');
  });

  it('resolves each step only once per pass', async () => {
        // A project counts thousands of tasks for about ten steps: without memory, the synchronization would make one database round trip per task.
    const resolve = departmentResolver(7);
    await resolve('Animation');
    await resolve('animation');
    await resolve(' Animation ');
    expect(resolveForTask).toHaveBeenCalledTimes(1);
  });

  it('returns an empty pair for a task without a step', async () => {
    const resolve = departmentResolver(7);
    expect(await resolve(null)).toEqual({ department: null, departmentId: null });
    expect(await resolve('   ')).toEqual({ department: null, departmentId: null });
    expect(resolveForTask).not.toHaveBeenCalled();
  });

  it('keeps its memory per pass: two synchronizations re-read the database', async () => {
    await departmentResolver(7)('Animation');
    await departmentResolver(7)('Animation');
    expect(resolveForTask).toHaveBeenCalledTimes(2);
  });
});
