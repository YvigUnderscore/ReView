// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { TaskStatus } from '@prisma/client';
import {
  FAMILY_OF_ENUM,
  FAMILY_PRIORITY,
  TASK_BLOCKED_FILTER,
  TASK_OPEN_FILTER,
  TASK_REVIEW_FILTER,
  familyOf,
  statusRefOf,
  taskPriority,
} from './statusFamily';

describe('statusFamily — fallback to the frozen enum', () => {
  it('maps the six historical statuses when no custom status is set', () => {
    // Original behavior: a studio without ShotGrid must see no change.
    expect(familyOf(TaskStatus.TODO)).toBe('todo');
    expect(familyOf(TaskStatus.IN_PROGRESS, null)).toBe('progress');
    expect(familyOf(TaskStatus.PENDING_REVIEW, null)).toBe('review');
    expect(familyOf(TaskStatus.APPROVED, null)).toBe('done');
    expect(familyOf(TaskStatus.RETAKE, null)).toBe('blocked');
    expect(familyOf(TaskStatus.REJECTED, null)).toBe('blocked');
  });

  it('covers exactly the enum', () => {
    expect(Object.keys(FAMILY_OF_ENUM).sort()).toEqual(Object.values(TaskStatus).sort());
  });
});

describe('statusFamily — PipelineStatus catalog', () => {
  const ref = (over: Partial<{ isDone: boolean; isInactive: boolean; legacyStatus: TaskStatus | null }>) => ({
    isDone: false,
    isInactive: false,
    legacyStatus: null,
    ...over,
  });

  it('counts as done whatever the site declares terminal, regardless of the enum', () => {
    // "fin" on a ShotGrid site: the local enum still says IN_PROGRESS.
    expect(familyOf(TaskStatus.IN_PROGRESS, ref({ isDone: true }))).toBe('done');
  });

  it('leaves inactive statuses out of the gauges, even when marked terminal', () => {
    expect(familyOf(TaskStatus.TODO, ref({ isInactive: true }))).toBe('inactive');
    expect(familyOf(TaskStatus.APPROVED, ref({ isInactive: true, isDone: true }))).toBe('inactive');
  });

  it('uses the legacyStatus bridge for intermediate families', () => {
    expect(familyOf(TaskStatus.TODO, ref({ legacyStatus: TaskStatus.PENDING_REVIEW }))).toBe('review');
    expect(familyOf(TaskStatus.TODO, ref({ legacyStatus: TaskStatus.RETAKE }))).toBe('blocked');
  });

  it('falls back to the task enum when the bridge is empty', () => {
    expect(familyOf(TaskStatus.IN_PROGRESS, ref({}))).toBe('progress');
  });

  it('never lets a non-terminal status count as done', () => {
    // Bridge misfilled (APPROVED) but isDone false: the gauge must not lie.
    expect(familyOf(TaskStatus.TODO, ref({ legacyStatus: TaskStatus.APPROVED }))).toBe('review');
    expect(familyOf(TaskStatus.APPROVED, ref({}))).toBe('review');
  });
});

describe('statusFamily — statusRefOf', () => {
  it('reads "no status set" from a null isDone, not "not done"', () => {
    expect(statusRefOf({ isDone: null, isInactive: null, legacyStatus: null })).toBeNull();
  });

  it('rebuilds the reference from flat columns', () => {
    expect(statusRefOf({ isDone: false, isInactive: null, legacyStatus: TaskStatus.RETAKE })).toEqual({
      isDone: false,
      isInactive: false,
      legacyStatus: TaskStatus.RETAKE,
    });
  });
});

describe('statusFamily — display priority', () => {
  it('puts what blocks first and what is closed last', () => {
    const order = (['blocked', 'review', 'progress', 'todo', 'done', 'inactive'] as const).map(
      (f) => FAMILY_PRIORITY[f],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('keeps exactly the historical order without a custom status', () => {
    // Original order: RETAKE, REJECTED, PENDING_REVIEW, IN_PROGRESS, TODO, APPROVED.
    const legacyOrder = [
      TaskStatus.RETAKE,
      TaskStatus.REJECTED,
      TaskStatus.PENDING_REVIEW,
      TaskStatus.IN_PROGRESS,
      TaskStatus.TODO,
      TaskStatus.APPROVED,
    ];
    const scores = legacyOrder.map((s) => taskPriority(s));
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(new Set(scores).size).toBe(scores.length);
  });

  it('sorts by the site family before the local enum', () => {
    // "rtk" on the ShotGrid side: the enum says IN_PROGRESS, so the task must come before a TODO.
    const retakeFromSite = taskPriority(TaskStatus.IN_PROGRESS, {
      isDone: false,
      isInactive: false,
      legacyStatus: TaskStatus.RETAKE,
    });
    expect(retakeFromSite).toBeLessThan(taskPriority(TaskStatus.TODO));
  });
});

describe('statusFamily — Prisma filters', () => {
  it('always exclude terminal and inactive statuses from the catalog', () => {
    for (const filter of [TASK_OPEN_FILTER, TASK_REVIEW_FILTER, TASK_BLOCKED_FILTER]) {
      const json = JSON.stringify(filter);
      expect(json).toContain('"isDone":false');
      expect(json).toContain('"isInactive":false');
    }
  });

  it('keep the enum fallback when no custom status is set', () => {
    expect(JSON.stringify(TASK_OPEN_FILTER)).toContain('"pipelineStatusId":null');
    expect(JSON.stringify(TASK_REVIEW_FILTER)).toContain('PENDING_REVIEW');
    expect(JSON.stringify(TASK_BLOCKED_FILTER)).toContain('RETAKE');
    expect(JSON.stringify(TASK_BLOCKED_FILTER)).toContain('REJECTED');
  });

  it('cover the custom status without a bridge, where the task enum takes over', () => {
    // Three branches: no status set, bridge filled, bridge empty.
    expect(TASK_REVIEW_FILTER.OR).toHaveLength(3);
    expect(TASK_BLOCKED_FILTER.OR).toHaveLength(3);
  });
});
