// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isLate, scheduleLabel } from './taskSchedule';

const NOW = new Date('2026-08-15T12:00:00Z').getTime();

describe('isLate', () => {
  it('recognises a past due date', () => {
    expect(isLate('2026-08-14', NOW)).toBe(true);
    expect(isLate('2026-08-20', NOW)).toBe(false);
  });

  it('does not pronounce itself without a due date', () => {
    expect(isLate(null, NOW)).toBe(false);
    expect(isLate(undefined, NOW)).toBe(false);
  });

  it('ignores an unreadable date rather than crying late', () => {
    expect(isLate('soon', NOW)).toBe(false);
  });
});

describe('scheduleLabel', () => {
  it('shows nothing when production has scheduled nothing', () => {
    expect(scheduleLabel({}, NOW)).toBeNull();
    expect(scheduleLabel({ startDate: null, dueDate: null }, NOW)).toBeNull();
  });

  it('gives the full window when both dates are set', () => {
    expect(scheduleLabel({ startDate: '2026-08-16', dueDate: '2026-08-20' }, NOW)).toEqual({
      key: 'task.schedule.window',
      start: '2026-08-16',
      due: '2026-08-20',
    });
  });

  it('lateness takes precedence over the window: that is what one looks for on a sheet', () => {
    expect(scheduleLabel({ startDate: '2026-08-01', dueDate: '2026-08-10' }, NOW)).toEqual({
      key: 'task.schedule.late',
      date: '2026-08-10',
    });
  });

  it('uses only the due date when the start is not set', () => {
    expect(scheduleLabel({ dueDate: '2026-08-20' }, NOW)).toEqual({
      key: 'task.schedule.due',
      date: '2026-08-20',
    });
  });

  it('a lone start date remains displayable', () => {
    expect(scheduleLabel({ startDate: '2026-08-16' }, NOW)).toEqual({
      key: 'task.schedule.window',
      start: '2026-08-16',
      due: '',
    });
  });
});
