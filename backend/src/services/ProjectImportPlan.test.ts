// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

// The plan is a pure function; only the deduction of the task type comes from a service that does talk to the
// database — we cut the plumbing, not the behaviour under test.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));

import { parseProjectCsv } from '../lib/projectCsvParse';
import {
  buildPlan,
  type ExistingEpisode,
  type ExistingSequence,
  type ExistingShot,
  type ExistingTask,
  type ImportContext,
} from './ProjectImportPlan';

const shot = (over: Partial<ExistingShot> & Pick<ExistingShot, 'id' | 'code'>): ExistingShot => ({
  sequenceId: null,
  name: over.code,
  description: null,
  startFrame: null,
  endFrame: null,
  pipelineStatusId: null,
  order: 0,
  trashed: false,
  ...over,
});

const sequence = (id: number, code: string, over: Partial<ExistingSequence> = {}): ExistingSequence => ({
  id,
  code,
  episodeId: null,
  trashed: false,
  ...over,
});

const episode = (id: number, code: string, trashed = false): ExistingEpisode => ({ id, code, trashed });

const task = (over: Partial<ExistingTask> & Pick<ExistingTask, 'id' | 'shotId' | 'name'>): ExistingTask => ({
  department: null,
  departmentId: null,
  pipelineStatusId: null,
  assigneeId: null,
  startDate: null,
  dueDate: null,
  ...over,
});

const context = (over: Partial<ImportContext> = {}): ImportContext => ({
  projectStartFrame: 1001,
  episodesEnabled: false,
  episodes: [],
  sequences: [],
  shots: [],
  tasks: [],
  shotStatuses: [{ id: 10, code: 'ip', name: 'In Progress' }],
  taskStatuses: [{ id: 20, code: 'wtg', name: 'Waiting to Start' }],
  departments: [
    { id: 30, key: 'ANIMATION', name: 'Animation' },
    { id: 31, key: 'COMPOSITING', name: 'Compositing' },
  ],
  members: [{ id: 40, email: 'mia@studio.tld', aliases: ['mia', 'Mia Okafor'] }],
  ...over,
});

const plan = (csv: string, ctx: ImportContext = context()) => buildPlan(parseProjectCsv(csv), ctx);

describe('buildPlan: first import', () => {
  it('creates sequences, shots and tasks, and counts what it is going to write', () => {
    const result = plan('sequence,shot,name,tasks\nSQ010,SH0010,Rooftop,Anim|Comp\nSQ010,SH0020,,Anim');
    expect(result.counts).toMatchObject({
      sequencesToCreate: 1,
      shotsToCreate: 2,
      tasksToCreate: 3,
      shotsUnchanged: 0,
    });
    expect(result.sequencesToCreate).toEqual([{ code: 'SQ010', episodeCode: null }]);
    expect(result.shotsToCreate[0]).toMatchObject({ sequenceCode: 'SQ010', code: 'SH0010', name: 'Rooftop' });
    // A missing name falls back on the shot's code, never on an empty string.
    expect(result.shotsToCreate[1]!.name).toBe('SH0020');
    expect(result.rows.map((r) => r.action)).toEqual(['create', 'create']);
  });

  it('guesses the step from the task name, if the project already knows it', () => {
    const result = plan('shot,tasks\nSH0010,Anim|Peinture');
    expect(result.tasksToCreate.map((t) => [t.name, t.departmentId])).toEqual([
      ['Anim', 30],
      ['Peinture', null],
    ]);
  });

  it('resolves status, step and person by code or by name', () => {
    const result = plan(
      'shot,shot_status,tasks,department,task_status,assignee\nSH0010,In Progress,Comp,Compositing,wtg,Mia Okafor',
    );
    expect(result.shotsToCreate[0]!.pipelineStatusId).toBe(10);
    expect(result.tasksToCreate[0]).toMatchObject({
      departmentId: 31,
      department: 'COMPOSITING',
      pipelineStatusId: 20,
      assigneeId: 40,
    });
  });

  it('flags what it does not recognise without losing the rest of the line', () => {
    const result = plan(
      'shot,shot_status,tasks,department,assignee\nSH0010,livré,Comp,Nettoyage,inconnu@x.tld',
    );
    expect(result.rows[0]!.issues.map((i) => i.code).sort()).toEqual([
      'UNKNOWN_ASSIGNEE',
      'UNKNOWN_DEPARTMENT',
      'UNKNOWN_STATUS',
    ]);
    expect(result.counts.shotsToCreate).toBe(1);
    expect(result.tasksToCreate[0]).toMatchObject({ departmentId: null, assigneeId: null });
  });
});

describe('buildPlan: idempotence', () => {
  const ctx = context({
    sequences: [sequence(1, 'SQ010')],
    shots: [
      shot({ id: 5, code: 'SH0010', sequenceId: 1, name: 'Rooftop', startFrame: 1001, endFrame: 1096 }),
    ],
    tasks: [task({ id: 7, shotId: 5, name: 'Anim', department: 'ANIMATION', departmentId: 30 })],
  });

  it('replaying the same file creates and modifies nothing', () => {
    const csv = 'sequence,shot,name,start_frame,end_frame,tasks\nSQ010,SH0010,Rooftop,1001,1096,Anim';
    expect(plan(csv, ctx).counts).toMatchObject({
      sequencesToCreate: 0,
      shotsToCreate: 0,
      shotsToUpdate: 0,
      shotsUnchanged: 1,
      tasksToCreate: 0,
      tasksToUpdate: 0,
      tasksUnchanged: 1,
    });
  });

  it('ignores the case of the shot and sequence code', () => {
    expect(plan('sequence,shot\nsq010,sh0010', ctx).counts).toMatchObject({
      sequencesToCreate: 0,
      shotsToCreate: 0,
      shotsUnchanged: 1,
    });
  });

  it('only updates the fields that actually changed', () => {
    const result = plan('sequence,shot,name,end_frame\nSQ010,SH0010,Terrace,1120', ctx);
    expect(result.shotUpdates).toEqual([{ id: 5, data: { name: 'Terrace', endFrame: 1120 } }]);
    expect(result.rows[0]!.action).toBe('update');
  });

  it('an absent column never erases an existing value', () => {
    expect(plan('sequence,shot\nSQ010,SH0010', ctx).shotUpdates).toEqual([]);
  });

  it('retouches an existing task rather than creating a twin', () => {
    const result = plan('sequence,shot,tasks,assignee,due_date\nSQ010,SH0010,anim,mia,2026-09-15', ctx);
    expect(result.tasksToCreate).toEqual([]);
    expect(result.taskUpdates).toEqual([{ id: 7, data: { assigneeId: 40, dueDate: '2026-09-15' } }]);
  });
});

describe('buildPlan: episodes', () => {
  it('ignores the episode column with a warning when the project has not enabled them', () => {
    const result = plan('episode,sequence,shot\nEP01,SQ010,SH0010');
    expect(result.episodesToCreate).toEqual([]);
    expect(result.issues.map((i) => i.code)).toContain('EPISODES_DISABLED');
    // The import carries on: it is a warning, not a failure.
    expect(result.counts.shotsToCreate).toBe(1);
  });

  it('creates the episode and attaches the sequence to it when the project has enabled them', () => {
    const result = plan('episode,sequence,shot\nEP01,SQ010,SH0010', context({ episodesEnabled: true }));
    expect(result.episodesToCreate).toEqual(['EP01']);
    expect(result.sequencesToCreate).toEqual([{ code: 'SQ010', episodeCode: 'EP01' }]);
  });

  it('re-glues an already existing sequence that changes episode', () => {
    const ctx = context({
      episodesEnabled: true,
      episodes: [episode(2, 'EP01'), episode(3, 'EP02')],
      sequences: [sequence(1, 'SQ010', { episodeId: 2 })],
    });
    expect(plan('episode,sequence,shot\nEP02,SQ010,SH0010', ctx).sequenceEpisodeUpdates).toEqual([
      { id: 1, episodeCode: 'EP02' },
    ]);
    expect(plan('episode,sequence,shot\nEP01,SQ010,SH0010', ctx).sequenceEpisodeUpdates).toEqual([]);
  });
});

describe('buildPlan: trash', () => {
  it('refuses the row whose shot is in the trash, without bringing down the others', () => {
    const ctx = context({
      shots: [shot({ id: 5, code: 'SH0010', trashed: true }), shot({ id: 6, code: 'SH0020' })],
    });
    const result = plan('shot,name\nSH0010,Rooftop\nSH0020,Terrace', ctx);
    expect(result.rows.map((r) => r.action)).toEqual(['blocked', 'update']);
    expect(result.rows[0]!.issues.map((i) => i.code)).toEqual(['IN_TRASH']);
    expect(result.counts.rowsRejected).toBe(1);
    expect(result.shotsToCreate).toEqual([]);
    expect(result.shotUpdates).toEqual([{ id: 6, data: { name: 'Terrace' } }]);
  });

  it('refuses the shots of a sequence in the trash rather than recreating it', () => {
    const ctx = context({ sequences: [sequence(1, 'SQ010', { trashed: true })] });
    const result = plan('sequence,shot\nSQ010,SH0010', ctx);
    expect(result.sequencesToCreate).toEqual([]);
    expect(result.rows[0]!.action).toBe('blocked');
  });

  it('leaves the sequence outside any episode when the targeted episode is in the trash', () => {
    const ctx = context({ episodesEnabled: true, episodes: [episode(2, 'EP01', true)] });
    const result = plan('episode,sequence,shot\nEP01,SQ010,SH0010', ctx);
    expect(result.episodesToCreate).toEqual([]);
    expect(result.sequencesToCreate).toEqual([{ code: 'SQ010', episodeCode: null }]);
    expect(result.issues.map((i) => i.code)).toContain('IN_TRASH');
    // The episode level is optional: the shot is created all the same.
    expect(result.counts.shotsToCreate).toBe(1);
  });
});

describe('buildPlan: identity of a task', () => {
  const ctx = context({
    shots: [shot({ id: 5, code: 'SH0010' })],
    tasks: [
      task({ id: 7, shotId: 5, name: 'Anim', department: 'ANIMATION', departmentId: 30 }),
      task({ id: 8, shotId: 5, name: 'Anim', department: 'COMPOSITING', departmentId: 31 }),
    ],
  });

  it('targets the task of the declared step, not the first homonym', () => {
    const result = plan('shot,tasks,department,assignee\nSH0010,Anim,Compositing,mia', ctx);
    expect(result.taskUpdates).toEqual([{ id: 8, data: { assigneeId: 40 } }]);
  });

  it('creates a homonym of another step instead of moving the existing one', () => {
    const single = context({
      shots: [shot({ id: 5, code: 'SH0010' })],
      tasks: [task({ id: 7, shotId: 5, name: 'Anim', department: 'ANIMATION', departmentId: 30 })],
    });
    const result = plan('shot,tasks,department\nSH0010,Anim,Compositing', single);
    expect(result.taskUpdates).toEqual([]);
    expect(result.tasksToCreate).toHaveLength(1);
    expect(result.tasksToCreate[0]).toMatchObject({ name: 'Anim', departmentId: 31 });
  });

  it('attaches in passing a homonym task that still has no step', () => {
    const orphan = context({
      shots: [shot({ id: 5, code: 'SH0010' })],
      tasks: [task({ id: 7, shotId: 5, name: 'Anim' })],
    });
    const result = plan('shot,tasks,department\nSH0010,Anim,Animation', orphan);
    expect(result.taskUpdates).toEqual([{ id: 7, data: { department: 'ANIMATION', departmentId: 30 } }]);
  });
});

describe('buildPlan: report', () => {
  it('counts the rejected rows and the warnings', () => {
    const result = plan('shot,tags,start_frame\nSH0010,hero|day,1001\n,x,2');
    expect(result.counts.rowsRejected).toBe(1);
    expect(result.issues.map((i) => i.code)).toContain('TAGS_UNSUPPORTED');
    expect(result.counts.warnings).toBeGreaterThan(0);
  });

  it('returns one report row per shot, with its file rows', () => {
    const result = plan('shot,tasks\nSH0010,Anim\nSH0010,Comp');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ line: 2, lines: [2, 3], tasks: { create: 2 } });
  });
});
