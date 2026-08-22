// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Seule la base est feinte : les fonctions de `lib/projectSettings` restent réelles, c'est
// leur composition avec l'écriture qu'on vérifie ici.
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
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
};

const admin = { id: 1, role: 'ADMIN' as const };
const findFirst = vi.mocked(prisma.project.findFirst);
const update = vi.mocked(prisma.project.update);
const departmentCount = vi.mocked(prisma.department.count);
const departmentUpdateMany = vi.mocked(prisma.department.updateMany);

/** Le JSON écrit par la dernière mise à jour du projet. */
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

describe('getSettings — effectif + sections surchargées', () => {
  it('404 quand le projet n’existe pas', async () => {
    findFirst.mockResolvedValue(null);
    await expect(getSettings(7)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('ne signale aucune surcharge sur un projet qui hérite de tout', async () => {
    const { settings, overrides } = await getSettings(7);
    expect(settings).toEqual(STUDIO);
    expect(overrides).toEqual([]);
  });

  it('signale les sections réellement surchargées, et elles seules', async () => {
    findFirst.mockResolvedValue({ settings: { framerate: 25, isTemplate: true } } as never);
    expect((await getSettings(7)).overrides).toEqual(['framerate']);
  });

  it('tient les départements pour surchargés dès que le projet a ses propres lignes', async () => {
    departmentCount.mockResolvedValue(4);
    expect((await getSettings(7)).overrides).toEqual(['departments']);
  });
});

describe('getSettingsOverride — vue d’édition', () => {
  it('rend l’override stocké ET les défauts studio dont le reste hérite', async () => {
    findFirst.mockResolvedValue({ settings: { resolution: { width: 4096, height: 2160 } } } as never);
    const { override, studio, overrides } = await getSettingsOverride(7);
    expect(override).toEqual({ resolution: { width: 4096, height: 2160 } });
    expect(studio).toEqual(STUDIO);
    expect(overrides).toEqual(['resolution']);
  });
});

describe('updateSettings (PUT) — remplacement de l’override', () => {
  it('N’ÉCRIT PAS les défauts studio reçus tels quels : seules les sections envoyées restent', async () => {
    // Le corps que l'ancien écran envoyait : les réglages EFFECTIFS, défauts studio compris.
    await updateSettings(admin, 7, { ...STUDIO, framerate: 25 });
    const stored = writtenSettings();
    expect(stored.framerate).toBe(25);
    // La résolution envoyée était celle du studio : elle reste une surcharge explicite ici,
    // puisque le PUT est un remplacement total — mais rien n'a été inventé en plus.
    expect(Object.keys(stored).sort()).toEqual(
      ['departments', 'framerate', 'naming', 'nomenclature', 'resolution'].sort(),
    );
  });

  it('rend à l’héritage les sections absentes du corps', async () => {
    findFirst.mockResolvedValue({ settings: { framerate: 25, color: { configId: 'x' } } } as never);
    await updateSettings(admin, 7, { framerate: 30 });
    expect(writtenSettings()).toEqual({ framerate: 30 });
  });

  it('404 quand le projet n’existe pas', async () => {
    findFirst.mockResolvedValue(null);
    await expect(updateSettings(admin, 7, { framerate: 30 })).rejects.toMatchObject({ statusCode: 404 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('patchSettings (PATCH) — écriture section par section', () => {
  it('n’enregistre QUE la section touchée : le studio continue de piloter le reste', async () => {
    await patchSettings(admin, 7, { nomenclature: { ...STUDIO.nomenclature, shotPrefix: 'PL' } });
    expect(writtenSettings()).toEqual({
      nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'PL', padding: 3, step: 10 },
    });
  });

  it('conserve les surcharges déjà posées', async () => {
    findFirst.mockResolvedValue({ settings: { framerate: 25 } } as never);
    await patchSettings(admin, 7, { resolution: { width: 4096, height: 2160 } });
    expect(writtenSettings()).toEqual({
      framerate: 25,
      resolution: { width: 4096, height: 2160 },
    });
  });

  it('rend une section à l’héritage sur null', async () => {
    findFirst.mockResolvedValue({ settings: { framerate: 25, color: { configId: 'x' } } } as never);
    await patchSettings(admin, 7, { framerate: null });
    expect(writtenSettings()).toEqual({ color: { configId: 'x' } });
  });

  it('traduit une liste de départements en entités', async () => {
    await patchSettings(admin, 7, { departments: [{ key: 'FX', name: 'FX' }] });
    expect(DepartmentService.syncFromSettings).toHaveBeenCalledWith(7, [{ key: 'FX', name: 'FX' }]);
    expect(departmentUpdateMany).not.toHaveBeenCalled();
  });

  it('retire le pipe propre du projet quand les départements retournent à l’héritage', async () => {
    await patchSettings(admin, 7, { departments: null });
    expect(DepartmentService.syncFromSettings).not.toHaveBeenCalled();
    expect(departmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 7, deletedAt: null } }),
    );
  });

  it('ne touche pas aux départements quand le PATCH ne les mentionne pas', async () => {
    await patchSettings(admin, 7, { framerate: 30 });
    expect(DepartmentService.syncFromSettings).not.toHaveBeenCalled();
    expect(departmentUpdateMany).not.toHaveBeenCalled();
  });
});
