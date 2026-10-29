// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MessageKey } from '../i18n';
import type { PipelineStatus } from '../types/shotgrid';
import {
  NO_STATUS,
  bodyForChoice,
  currentStatusValue,
  statusChoices,
  withStatus,
  withStatusOne,
} from './statusMenu';

const t = (key: MessageKey) => key;

const status = (over: Partial<PipelineStatus> & { id: number }): PipelineStatus => ({
  scope: 'task',
  code: 'ip',
  name: 'In Progress',
  color: '#3B82F6',
  order: 0,
  isDone: false,
  isDefault: false,
  legacyStatus: 'IN_PROGRESS',
  ...over,
});

describe('statusChoices', () => {
  it('returns one choice per catalogue status, in the order received', () => {
    const choices = statusChoices(
      [status({ id: 1, name: 'Waiting', code: 'wtg' }), status({ id: 2 })],
      'shot',
      t,
    );
    expect(choices.map((c) => c.value)).toEqual(['1', '2']);
    // The name of a status is studio data: never translated, never rewritten.
    expect(choices[0].label).toBe('Waiting');
    expect(choices[0].color).toBe('#3B82F6');
  });

  it('falls back to the six historical values for a task without a catalogue', () => {
    const choices = statusChoices([], 'task', t);
    expect(choices).toHaveLength(6);
    expect(choices[0].value).toBe('legacy:TODO');
    expect(choices[0].statusId).toBeNull();
  });

  it('offers nothing for a shot or a sequence without a catalogue', () => {
    // Their PATCH only accepts `pipelineStatusId`: offering the historical values would give a
    // menu that fails every time. Better not to display it.
    expect(statusChoices([], 'shot', t)).toEqual([]);
    expect(statusChoices([], 'sequence', t)).toEqual([]);
  });
});

describe('currentStatusValue', () => {
  const choices = statusChoices([status({ id: 7 }), status({ id: 8, legacyStatus: 'APPROVED' })], 'task', t);

  it('finds the choice by its identifier', () => {
    expect(currentStatusValue(choices, { pipelineStatusId: 8 })).toBe('8');
  });

  it('falls back to the same family when the identifier is no longer offered', () => {
    // A status inherited from another site or from a changed vocabulary: showing the family is
    // better than claiming that no status is set.
    expect(currentStatusValue(choices, { pipelineStatusId: 999, status: 'APPROVED' })).toBe('8');
  });

  it('returns the sentinel when nothing is set', () => {
    expect(currentStatusValue(choices, {})).toBe(NO_STATUS);
  });
});

describe('bodyForChoice', () => {
  const choices = statusChoices([status({ id: 12 })], 'task', t);

  it('sends the identifier alone for a catalogue status', () => {
    const body = bodyForChoice(choices, '12');
    expect(body).toEqual({ pipelineStatusId: 12 });
    // Certainly not `status` as well: the server derives it and its derivation takes precedence.
    expect(body && 'status' in body).toBe(false);
  });

  it('sends the enum for a fallback choice', () => {
    expect(bodyForChoice(statusChoices([], 'task', t), 'legacy:IN_PROGRESS')).toEqual({
      status: 'IN_PROGRESS',
    });
  });

  it('clears the status on the sentinel', () => {
    expect(bodyForChoice(choices, NO_STATUS)).toEqual({ pipelineStatusId: null });
  });

  it('builds nothing for an unknown value', () => {
    expect(bodyForChoice(choices, '404')).toBeNull();
  });
});

describe('withStatus', () => {
  const choice = statusChoices([status({ id: 5, legacyStatus: 'APPROVED' })], 'task', t)[0];

  it('writes both fields so that the column and the badge follow together', () => {
    const next = withStatusOne({ id: 1, name: 'x', pipelineStatusId: null, status: 'TODO' as const }, choice);
    expect(next.pipelineStatusId).toBe(5);
    expect(next.status).toBe('APPROVED');
    expect(next.name).toBe('x');
  });

  it('clears both fields on a removal', () => {
    expect(withStatusOne({ id: 1, pipelineStatusId: 5 }, null).pipelineStatusId).toBeNull();
  });

  it('only touches the targeted element in a list', () => {
    const list = [
      { id: 1, pipelineStatusId: null },
      { id: 2, pipelineStatusId: null },
    ];
    const next = withStatus(list, 2, choice);
    expect(next[0].pipelineStatusId).toBeNull();
    expect(next[1].pipelineStatusId).toBe(5);
  });
});
