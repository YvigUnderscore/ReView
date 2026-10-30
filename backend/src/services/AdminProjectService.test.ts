// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

// Pure functions under test: env/DB dependencies of the imports are stubbed out.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/storage', () => ({ storage: {} }));

import { buildHierarchy, hasPipelineOverride } from './AdminProjectService';
import type { ProjectSettings } from '../lib/projectSettings';

const projectSettings: ProjectSettings = {
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
  departments: [],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
  reviewRequest: { requireNote: false, minNoteLength: 5 },
};

describe('AdminProjectService — hasPipelineOverride', () => {
  it('detects resolution or framerate, ignores the rest', () => {
    expect(hasPipelineOverride(null)).toBe(false);
    expect(hasPipelineOverride({})).toBe(false);
    expect(hasPipelineOverride({ autre: 1 })).toBe(false);
    expect(hasPipelineOverride({ framerate: 30 })).toBe(true);
    expect(hasPipelineOverride({ resolution: { width: 1280, height: 720 } })).toBe(true);
  });
});

describe('AdminProjectService — buildHierarchy', () => {
  it('resolves project->sequence->shot inheritance and sets the override flags', () => {
    const h = buildHierarchy(
      projectSettings,
      [
        {
          id: 1,
          code: 'SQ010',
          name: 'ouverture',
          settings: { framerate: 25 },
          shots: [
            {
              id: 10,
              code: 'SH010',
              name: 'plan a',
              startFrame: 1001,
              endFrame: 1100,
              settings: {},
            },
            {
              id: 11,
              code: 'SH020',
              name: 'plan b',
              startFrame: null,
              endFrame: null,
              settings: { resolution: { width: 3840, height: 2160 } },
            },
          ],
        },
      ],
      [{ id: 20, code: 'SH900', name: 'orphelin', startFrame: null, endFrame: null, settings: {} }],
    );

    const seq = h.sequences[0]!;
    expect(seq.override).toBe(true);
    expect(seq.effective).toEqual({ resolution: { width: 1920, height: 1080 }, framerate: 25 });

    // SH010 inherits from the sequence (25 fps), with no override of its own.
    expect(seq.shots[0]!.override).toBe(false);
    expect(seq.shots[0]!.effective.framerate).toBe(25);
    // SH020 overrides the resolution but inherits the sequence framerate.
    expect(seq.shots[1]!.override).toBe(true);
    expect(seq.shots[1]!.effective).toEqual({
      resolution: { width: 3840, height: 2160 },
      framerate: 25,
    });

    // Shot without a sequence: inherits directly from the project.
    expect(h.noSequence[0]!.override).toBe(false);
    expect(h.noSequence[0]!.effective).toEqual({
      resolution: { width: 1920, height: 1080 },
      framerate: 24,
    });
  });

  it('returns empty lists for a project without structure', () => {
    expect(buildHierarchy(projectSettings, [], [])).toEqual({ sequences: [], noSequence: [] });
  });
});
