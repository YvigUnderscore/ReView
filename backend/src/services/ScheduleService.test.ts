import { describe, it, expect } from 'vitest';
import { toScheduleTask, type ScheduleRow } from './ScheduleService';

const base: ScheduleRow = {
  id: 1,
  name: 'anim',
  type: 'ANIMATION',
  status: 'IN_PROGRESS',
  startDate: new Date('2026-07-13T00:00:00Z'),
  dueDate: new Date('2026-07-20T00:00:00Z'),
  assignee: { id: 9, name: 'Ada' },
  shot: { code: 'SH020', sequence: { id: 3, code: 'SQ010' } },
  asset: null,
};

describe('ScheduleService — toScheduleTask', () => {
  it('compose la localisation shot avec séquence et expose les dates ISO', () => {
    const t = toScheduleTask(base);
    expect(t.location).toBe('SQ010 · SH020');
    expect(t.sequenceId).toBe(3);
    expect(t.sequenceCode).toBe('SQ010');
    expect(t.dueDate).toBe('2026-07-20T00:00:00.000Z');
    expect(t.startDate).toBe('2026-07-13T00:00:00.000Z');
    expect(t.assignee).toEqual({ id: 9, name: 'Ada' });
  });

  it('gère un shot sans séquence', () => {
    const t = toScheduleTask({ ...base, shot: { code: 'SH999', sequence: null } });
    expect(t.location).toBe('SH999');
    expect(t.sequenceId).toBeNull();
  });

  it('utilise le nom d’asset et gère l’absence de dates/assigné', () => {
    const t = toScheduleTask({
      ...base,
      shot: null,
      asset: { name: 'Robot' },
      startDate: null,
      dueDate: null,
      assignee: null,
    });
    expect(t.location).toBe('Robot');
    expect(t.startDate).toBeNull();
    expect(t.dueDate).toBeNull();
    expect(t.assignee).toBeNull();
  });
});
