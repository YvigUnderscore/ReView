// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Only the database is faked: the functions of `lib/projectSettings` remain real — it is their composition
// with the write that is verified here.
vi.mock('../lib/prisma', () => ({
  prisma: {
    project: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    department: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    setting: { findUnique: vi.fn() },
  },
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  purgeProject: vi.fn(),
}));
vi.mock('../lib/thumbnails', () => ({ effectiveThumbnailUrl: vi.fn() }));
vi.mock('./DepartmentService', () => ({ syncFromSettings: vi.fn() }));

import { getSettings, getSettingsOverride, patchSettings, updateSettings } from './ProjectService';
import { prisma } from '../lib/prisma';
import * as DepartmentService from './DepartmentService';
import { STUDIO_DEFAULTS_KEY, type ProjectSettings } from '../lib/projectSettings';

const STUDIO: ProjectSettings = {
  departments: [{ key: 'ANIM', name: 'Animation' }],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
  reviewRequest: { requireNote: false, minNoteLength: 5 },
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
};

const admin = { id: 1, role: 'ADMIN' as const };
const findFirst = vi.mocked(prisma.project.findFirst);
const update = vi.mocked(prisma.project.update);
const departmentCount = vi.mocked(prisma.department.count);
const departmentUpdateMany = vi.mocked(prisma.department.updateMany);

/** The JSON written by the project's latest update. */
const writtenSettings = () =>
  (update.mock.calls.at(-1)![0] as { data: { settings: Record<string, unknown> } }).data.settings;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.setting.findUnique).mockResolvedValue({
    key: STUDIO_DEFAULTS_KEY,
    value: JSON.stringify(STUDIO),
  });
  vi.mocked(prisma.project.findUnique).mockResolvedValue({ settings: {}, studioId: 1 } as never);
  vi.mocked(prisma.department.findMany).mockResolvedValue([] as never);
  departmentCount.mockResolvedValue(0);
  update.mockResolvedValue({} as never);
  findFirst.mockResolvedValue({ settings: {} } as never);
});

describe('getSettings: effective + overridden sections', () => {
  it('404 when the project does not exist', async () => {
    findFirst.mockResolvedValue(null);
    await expect(getSettings(7)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reports no override on a project that inherits everything', async () => {
    const { settings, overrides } = await getSettings(7);
    expect(settings).toEqual(STUDIO);
    expect(overrides).toEqual([]);
  });

  it('reports the sections actually overridden, and only those', async () => {
    findFirst.mockResolvedValue({ settings: { framerate: 25, isTemplate: true } } as never);
    expect((await getSettings(7)).overrides).toEqual(['framerate']);
  });

  it('treats departments as overridden as soon as the project has its own rows', async () => {
    departmentCount.mockResolvedValue(4);
    expect((await getSettings(7)).overrides).toEqual(['departments']);
  });
});

describe('getSettingsOverride: edit view', () => {
  it('returns the stored override AND the studio defaults the rest inherits', async () => {
    findFirst.mockResolvedValue({ settings: { resolution: { width: 4096, height: 2160 } } } as never);
    const { override, studio, overrides } = await getSettingsOverride(7);
    expect(override).toEqual({ resolution: { width: 4096, height: 2160 } });
    expect(studio).toEqual(STUDIO);
    expect(overrides).toEqual(['resolution']);
  });
});

describe('updateSettings (PUT): replacement of the override', () => {
  it('does NOT WRITE the studio defaults received as is: only the sections sent remain', async () => {
    // The body the old screen sent: the EFFECTIVE settings, studio defaults included.
    await updateSettings(admin, 7, { ...STUDIO, framerate: 25 });
    const stored = writtenSettings();
    expect(stored.framerate).toBe(25);
    // The resolution sent was the studio's: it remains an explicit override here, since the PUT is a total
    // replacement — but nothing was invented on top.
    expect(Object.keys(stored).sort()).toEqual(
      ['departments', 'framerate', 'naming', 'nomenclature', 'resolution', 'reviewRequest'].sort(),
    );
  });

  it('returns to inheritance the sections absent from the body', async () => {
    findFirst.mockResolvedValue({ settings: { framerate: 25, color: { configId: 'x' } } } as never);
    await updateSettings(admin, 7, { framerate: 30 });
    expect(writtenSettings()).toEqual({ framerate: 30 });
  });

  it('404 when the project does not exist', async () => {
    findFirst.mockResolvedValue(null);
    await expect(updateSettings(admin, 7, { framerate: 30 })).rejects.toMatchObject({ statusCode: 404 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('patchSettings (PATCH): section-by-section write', () => {
  it('saves ONLY the touched section: the studio continues to drive the rest', async () => {
    await patchSettings(admin, 7, { nomenclature: { ...STUDIO.nomenclature, shotPrefix: 'PL' } });
    expect(writtenSettings()).toEqual({
      nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'PL', padding: 3, step: 10 },
    });
  });

  it('keeps the overrides already set', async () => {
    findFirst.mockResolvedValue({ settings: { framerate: 25 } } as never);
    await patchSettings(admin, 7, { resolution: { width: 4096, height: 2160 } });
    expect(writtenSettings()).toEqual({
      framerate: 25,
      resolution: { width: 4096, height: 2160 },
    });
  });

  it('returns a section to inheritance on null', async () => {
    findFirst.mockResolvedValue({ settings: { framerate: 25, color: { configId: 'x' } } } as never);
    await patchSettings(admin, 7, { framerate: null });
    expect(writtenSettings()).toEqual({ color: { configId: 'x' } });
  });

  it('translates a list of departments into entities', async () => {
    await patchSettings(admin, 7, { departments: [{ key: 'FX', name: 'FX' }] });
    expect(DepartmentService.syncFromSettings).toHaveBeenCalledWith(7, [{ key: 'FX', name: 'FX' }]);
    expect(departmentUpdateMany).not.toHaveBeenCalled();
  });

  it('removes the project\'s own pipe when the departments return to inheritance', async () => {
    await patchSettings(admin, 7, { departments: null });
    expect(DepartmentService.syncFromSettings).not.toHaveBeenCalled();
    expect(departmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 7, deletedAt: null } }),
    );
  });

  it('does not touch the departments when the PATCH does not mention them', async () => {
    await patchSettings(admin, 7, { framerate: 30 });
    expect(DepartmentService.syncFromSettings).not.toHaveBeenCalled();
    expect(departmentUpdateMany).not.toHaveBeenCalled();
  });
});
