// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { TaskType } from '@prisma/client';

// Only the deduction of the type interests us here: the rest of the service talks to the database.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));

import { inferTaskType } from './PipelineEnsureService';

describe('inferTaskType', () => {
  it('recognises the usual task names and their abbreviations', () => {
    const cases: [string, TaskType][] = [
      ['anim', TaskType.ANIMATION],
      ['animation', TaskType.ANIMATION],
      ['modeling', TaskType.MODELING],
      ['mod', TaskType.MODELING],
      ['rigging', TaskType.RIGGING],
      ['fx', TaskType.FX],
      ['lighting', TaskType.LIGHTING],
      ['lgt', TaskType.LIGHTING],
      ['comp', TaskType.COMPOSITING],
      ['lookdev', TaskType.LOOKDEV],
      ['layout', TaskType.LAYOUT],
    ];
    for (const [name, expected] of cases) expect(inferTaskType(name)).toBe(expected);
  });

  it('ignores case and department suffixes', () => {
    expect(inferTaskType('ANIM_main')).toBe(TaskType.ANIMATION);
    expect(inferTaskType('Lighting_key')).toBe(TaskType.LIGHTING);
  });

  it('falls back on OTHER for an unrecognised name', () => {
    expect(inferTaskType('previz-client')).toBe(TaskType.OTHER);
    expect(inferTaskType('')).toBe(TaskType.OTHER);
  });
});
