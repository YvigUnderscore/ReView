// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isLate, scheduleLabel } from './taskSchedule';

const NOW = new Date('2026-08-15T12:00:00Z').getTime();

describe('isLate', () => {
  it('reconnaît une échéance passée', () => {
    expect(isLate('2026-08-14', NOW)).toBe(true);
    expect(isLate('2026-08-20', NOW)).toBe(false);
  });

  it('ne se prononce pas sans échéance', () => {
    expect(isLate(null, NOW)).toBe(false);
    expect(isLate(undefined, NOW)).toBe(false);
  });

  it('ignore une date illisible plutôt que de crier au retard', () => {
    expect(isLate('bientôt', NOW)).toBe(false);
  });
});

describe('scheduleLabel', () => {
  it('n’affiche rien quand la production n’a rien planifié', () => {
    expect(scheduleLabel({}, NOW)).toBeNull();
    expect(scheduleLabel({ startDate: null, dueDate: null }, NOW)).toBeNull();
  });

  it('donne la fenêtre complète quand les deux dates sont là', () => {
    expect(scheduleLabel({ startDate: '2026-08-16', dueDate: '2026-08-20' }, NOW)).toEqual({
      key: 'task.schedule.window',
      start: '2026-08-16',
      due: '2026-08-20',
    });
  });

  it('le retard prime sur la fenêtre : c’est ce qu’on cherche sur une fiche', () => {
    expect(scheduleLabel({ startDate: '2026-08-01', dueDate: '2026-08-10' }, NOW)).toEqual({
      key: 'task.schedule.late',
      date: '2026-08-10',
    });
  });

  it('se contente de l’échéance quand le début n’est pas fixé', () => {
    expect(scheduleLabel({ dueDate: '2026-08-20' }, NOW)).toEqual({
      key: 'task.schedule.due',
      date: '2026-08-20',
    });
  });

  it('une date de début seule reste affichable', () => {
    expect(scheduleLabel({ startDate: '2026-08-16' }, NOW)).toEqual({
      key: 'task.schedule.window',
      start: '2026-08-16',
      due: '',
    });
  });
});
