// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The review frame's ratio comes from the pipeline settings, and from nowhere else.
 *
 * The format tooltip promised "inherited from the shot's pipeline settings", while the aspect was copied from
 * the camera presentation — that is, from the 16/9 default, frozen at the first staging save. This bench
 * exercises the real chain: studio → project → sequence → shot, each level overriding the upstream one when
 * it has an opinion.
 */

const { db } = vi.hoisted(() => ({ db: { version: { findUnique: vi.fn() } } }));

vi.mock('./prisma', () => ({ prisma: db }));
// `resolveEntitySettings` stays REAL: it is the inheritance rule we want to see applied.
// Only the reading of the project settings is simulated (it queries studio + departments).
vi.mock('./projectSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./projectSettings')>()),
  resolveProjectSettingsById: vi.fn(),
}));

import { aspectOfResolution, DEFAULT_DELIVERY_ASPECT, resolveDeliveryAspect } from './deliveryAspect';
import { resolveProjectSettingsById } from './projectSettings';

const VERSION = 12;
const PROJECT = 3;

/** Minimal project settings — only the resolution matters for this bench. */
const projectSettings = (width: number, height: number) =>
  ({ resolution: { width, height }, framerate: 24 }) as never;

/** Version attached to a shot, with the pipeline overrides of the sequence and of the shot. */
const versionUnder = (sequence: unknown, shot: unknown) => ({
  task: { shot: { settings: shot, sequence: { settings: sequence } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveProjectSettingsById).mockResolvedValue(projectSettings(1920, 1080));
});

describe('aspectOfResolution', () => {
  it('returns the width/height ratio of the delivery resolution', () => {
    expect(aspectOfResolution({ width: 2048, height: 858 })).toBeCloseTo(2048 / 858);
  });

  // A non-finite aspect produces a zero-height frame, i.e. an empty viewer.
  it('falls back to 16:9 for a missing or aberrant resolution', () => {
    expect(aspectOfResolution(undefined)).toBeCloseTo(DEFAULT_DELIVERY_ASPECT);
    expect(aspectOfResolution({ width: 0, height: 1080 })).toBeCloseTo(DEFAULT_DELIVERY_ASPECT);
    expect(aspectOfResolution({ width: 1920, height: Number.NaN })).toBeCloseTo(DEFAULT_DELIVERY_ASPECT);
  });
});

describe('resolveDeliveryAspect — inheritance studio → project → sequence → shot', () => {
  it('takes the resolution of the SHOT when it has an opinion', async () => {
    db.version.findUnique.mockResolvedValue(
      versionUnder(
        { resolution: { width: 1998, height: 1080 } },
        { resolution: { width: 2048, height: 858 } },
      ),
    );
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(2048 / 858);
  });

  it('falls back to the SEQUENCE when the shot has no opinion', async () => {
    db.version.findUnique.mockResolvedValue(
      versionUnder({ resolution: { width: 1998, height: 1080 } }, null),
    );
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(1998 / 1080);
  });

  it('falls back to the PROJECT when neither the shot nor the sequence has an opinion', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(projectSettings(4096, 1716));
    db.version.findUnique.mockResolvedValue(versionUnder(null, null));
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(4096 / 1716);
  });

  // `resolveProjectSettingsById` already completes the project with the studio defaults: a version outside
  // any shot (asset, delivery without task) therefore inherits that value.
  it('takes the ratio of the project when the version hangs from no shot', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(projectSettings(1920, 1080));
    db.version.findUnique.mockResolvedValue({ task: null });
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(16 / 9);
  });

  it('inherits only one axis when the level overrides only one', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(projectSettings(4096, 2160));
    db.version.findUnique.mockResolvedValue(versionUnder(null, { resolution: { height: 1716 } }));
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(4096 / 1716);
  });

  it('queries the shot of the REQUESTED version, sequence included', async () => {
    db.version.findUnique.mockResolvedValue(versionUnder(null, null));
    await resolveDeliveryAspect(VERSION, PROJECT);
    expect(db.version.findUnique).toHaveBeenCalledWith({
      where: { id: VERSION },
      select: {
        task: { select: { shot: { select: { settings: true, sequence: { select: { settings: true } } } } } },
      },
    });
    expect(vi.mocked(resolveProjectSettingsById)).toHaveBeenCalledWith(PROJECT);
  });
});
