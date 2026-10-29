// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewTaskDialog from './NewTaskDialog';
import { t } from '../../i18n';

const { steps, createTask, members, sgMembers } = vi.hoisted(() => ({
  steps: vi.fn(),
  createTask: vi.fn(),
  members: vi.fn(),
  sgMembers: vi.fn(),
}));

vi.mock('../../lib/taskSteps', () => ({
  useTaskSteps: steps,
  useCreateStepTask: () => createTask,
}));
vi.mock('../../lib/useProjectRole', () => ({ useProjectMembers: members }));
vi.mock('../../lib/shotgridTasksApi', () => ({ useSgProjectMembers: sgMembers }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const LOCAL_STEPS = [
  { key: 'dept-1', code: 'ANIM', color: null },
  { key: 'dept-2', code: 'COMP', color: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  steps.mockReturnValue({ linked: false, steps: LOCAL_STEPS, isLoading: false });
  members.mockReturnValue([{ id: 8, name: 'Alice', role: 'ARTIST', avatarUrl: null }]);
  sgMembers.mockReturnValue({ data: [] });
  createTask.mockResolvedValue({ taskId: 77, name: 'ANIM' });
});

const mount = (kind: 'asset' | 'shot' = 'shot') =>
  render(
    <NewTaskDialog
      open
      onOpenChange={() => {}}
      projectId={3}
      parent={{ kind, id: 12 }}
      onCreated={() => {}}
    />,
  );

const create = () => screen.getByRole('button', { name: t('common.create') });

/**
 * A task was only ever created indirectly: by requesting a version, or by assigning someone. On a project not
 * linked to any site, the pipe therefore stayed empty, whereas the project's departments already describe the
 * steps it goes through.
 */
describe('NewTaskDialog — standalone project', () => {
  it("proposes the project's steps, promising nothing to ShotGrid", () => {
    mount();
    expect(screen.getByText(t('task.new.hint'))).toBeTruthy();
    expect(screen.getByRole('option', { name: 'ANIM' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'COMP' })).toBeTruthy();
  });

  it('lets a task be created without a step: an empty pipe is not a dead end', async () => {
    const user = userEvent.setup();
    mount();
    await user.selectOptions(screen.getByRole('combobox', { name: t('task.new.step') }), 'none');
    await user.type(screen.getByLabelText(t('common.name')), 'Retake client');
    await user.click(create());
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ step: null, name: 'Retake client', assigneeId: null }),
    );
  });

  it('writes the chosen step and person onto the open parent', async () => {
    const user = userEvent.setup();
    mount('asset');
    await user.selectOptions(screen.getByRole('combobox', { name: t('task.new.assignee') }), '8');
    await user.click(create());
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        step: LOCAL_STEPS[0],
        parent: { kind: 'asset', id: 12 },
        assigneeId: 8,
      }),
    );
    // The ShotGrid path must not impose itself: the task is born in ReView.
    expect(createTask.mock.calls[0][0]).not.toHaveProperty('assigneeSgId');
  });
});

describe('NewTaskDialog — project linked to ShotGrid', () => {
  beforeEach(() => {
    steps.mockReturnValue({
      linked: true,
      steps: [{ key: 'sg-4', code: 'Animation', color: '#0f0', sgId: 4 }],
      isLoading: false,
    });
    sgMembers.mockReturnValue({ data: [{ sgId: 91, name: 'Bob', email: null, userId: null }] });
  });

  it('does not offer "no step": the task must carry a step of the site', () => {
    mount();
    expect(screen.getByText(t('task.new.hintShotgrid'))).toBeTruthy();
    expect(screen.queryByRole('option', { name: t('pipeline.dept.none') })).toBeNull();
  });

  it('assigns with the site identifier, not the ReView one', async () => {
    const user = userEvent.setup();
    mount();
    await user.selectOptions(screen.getByRole('combobox', { name: t('task.new.assignee') }), '91');
    await user.click(create());
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ assigneeSgId: 91 }));
    expect(createTask.mock.calls[0][0]).not.toHaveProperty('assigneeId');
  });

  it('says why nothing is offered when the site returns no step', () => {
    steps.mockReturnValue({ linked: true, steps: [], isLoading: false });
    mount();
    expect(screen.getByText(t('task.new.noSteps'))).toBeTruthy();
    expect(create()).toBeDisabled();
  });
});
