// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { TaskType } from '@prisma/client';

// Seule la déduction du type nous intéresse ici : le reste du service parle à la base.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));

import { inferTaskType } from './PipelineEnsureService';

describe('inferTaskType', () => {
  it('reconnaît les noms de tâches usuels et leurs abréviations', () => {
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

  it('ignore la casse et les suffixes de département', () => {
    expect(inferTaskType('ANIM_main')).toBe(TaskType.ANIMATION);
    expect(inferTaskType('Lighting_key')).toBe(TaskType.LIGHTING);
  });

  it('retombe sur OTHER pour un nom non reconnu', () => {
    expect(inferTaskType('previz-client')).toBe(TaskType.OTHER);
    expect(inferTaskType('')).toBe(TaskType.OTHER);
  });
});
