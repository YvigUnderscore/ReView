// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskPickerDialog, { type PickableTask } from './TaskPickerDialog';
import { t } from '../../i18n';

const { projectTasks, steps, createTask, sgMembers } = vi.hoisted(() => ({
  projectTasks: vi.fn(),
  steps: vi.fn(),
  createTask: vi.fn(),
  sgMembers: vi.fn(),
}));

vi.mock('../../lib/queries', () => ({ useProjectTasks: projectTasks }));
vi.mock('../../lib/taskSteps', () => ({
  useTaskSteps: steps,
  useCreateStepTask: () => createTask,
}));
vi.mock('../../lib/shotgridTasksApi', () => ({ useSgProjectMembers: sgMembers }));
vi.mock('../shotgrid/PipelineStatusBadge', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** The open asset's tasks — the ones the page has already loaded. */
const MINE: PickableTask[] = [
  { id: 41, name: 'Lookdev', department: 'lookdev', pipelineStatusId: null, versionCount: 2 },
];

/**
 * The rest of the project, from the same side: this is exactly what the dialog wrongly
 * offered under "Elsewhere in the project".
 */
const PROJECT = [
  {
    id: 41,
    name: 'Lookdev',
    department: 'lookdev',
    pipelineStatusId: null,
    parentKind: 'asset' as const,
    parentName: 'test',
    versionCount: 2,
  },
  {
    id: 90,
    name: 'Layout',
    department: 'layout',
    pipelineStatusId: null,
    parentKind: 'asset' as const,
    parentName: 'Train Yard Scan',
    versionCount: 1,
  },
  {
    id: 91,
    name: 'Groom',
    department: 'groom',
    pipelineStatusId: null,
    parentKind: 'shot' as const,
    parentName: 'SH010',
    versionCount: 3,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  projectTasks.mockReturnValue({ data: PROJECT });
  steps.mockReturnValue({ linked: false, steps: [], isLoading: false });
  sgMembers.mockReturnValue({ data: [] });
  createTask.mockResolvedValue({ taskId: 77, name: 'ANIM' });
});

const mount = (props: Partial<Parameters<typeof TaskPickerDialog>[0]> = {}) => {
  const onPick = vi.fn();
  render(
    <TaskPickerDialog
      open
      onOpenChange={() => {}}
      tasks={MINE}
      projectId={3}
      parent={{ kind: 'asset', id: 12 }}
      onPick={onPick}
      {...props}
    />,
  );
  return onPick;
};

/**
 * The dialog opens from an entity: offering the tasks of another one invites filing the
 * version in the wrong place, and ShotGrid receives it there — which cannot be undone.
 */
describe('TaskPickerDialog — destinations', () => {
  it('only offers the tasks of the open entity', () => {
    mount();
    expect(screen.getByRole('button', { name: /Lookdev/ })).toBeTruthy();
    // Another asset from the same side: that was the "elsewhere in the project" section.
    expect(screen.queryByRole('button', { name: /Layout/ })).toBeNull();
    expect(screen.queryByText(/Train Yard Scan/)).toBeNull();
    // And, a fortiori, no plan task.
    expect(screen.queryByRole('button', { name: /Groom/ })).toBeNull();
    expect(screen.queryByText(/SH010/)).toBeNull();
  });

  it('returns the chosen task, the entity\'s own', async () => {
    const user = userEvent.setup();
    const onPick = mount();
    await user.click(screen.getByRole('button', { name: /Lookdev/ }));
    expect(onPick).toHaveBeenCalledWith(41);
  });

  it('allows attaching to the parent when the page permits it, never otherwise', () => {
    mount({ allowNone: true });
    expect(screen.getByRole('button', { name: t('upload.pickTask.none') })).toBeTruthy();
  });

  it('does not offer attaching to the parent without `allowNone`', () => {
    mount();
    expect(screen.queryByRole('button', { name: t('upload.pickTask.none') })).toBeNull();
  });
});

describe('TaskPickerDialog — missing step', () => {
  beforeEach(() => {
    steps.mockReturnValue({
      linked: false,
      steps: [{ key: 'dept-7', code: 'ANIM', color: null }],
      isLoading: false,
    });
  });

  it('creates the missing step on the open entity', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      screen.getByRole('button', { name: t('upload.pickTask.createStepLocal', { step: 'ANIM' }) }),
    );
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ parent: { kind: 'asset', id: 12 } }));
  });

  it('still suggests the project names as autocompletion — a name is not a destination', () => {
    mount();
    const names = [...document.querySelectorAll('#review-task-names option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(names).toContain('Lookdev');
    expect(names).toContain('Layout');
  });
});

/**
 * No task on the entity AND no writable step: the dialog then rendered an empty box whose
 * only exit was the modal's close button — so an impossible drop.
 * The case is not exotic: nothing seeds a department at installation, the department policy
 * only leaves a step writable to whoever belongs to one of them, and a linked site may expose
 * no step at all for this kind of entity.
 */
describe('TaskPickerDialog — no destination', () => {
  beforeEach(() => {
    projectTasks.mockReturnValue({ data: [] });
    steps.mockReturnValue({ linked: false, steps: [], isLoading: false });
  });

  it('never gets stuck: the task without a step reopens the drop', async () => {
    const user = userEvent.setup();
    const onPick = mount({ tasks: [], parent: { kind: 'shot', id: 12 } });
    expect(screen.getByText(t('upload.pickTask.barren'))).toBeTruthy();
    const create = screen.getByRole('button', { name: t('upload.pickTask.createStepless') });
    // Without a name, the server would refuse the task: the button waits for one to be given.
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText(t('upload.pickTask.nameRequired')), 'compo fix');
    expect(create).toBeEnabled();
    await user.click(create);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ step: null, name: 'compo fix', parent: { kind: 'shot', id: 12 } }),
    );
    expect(onPick).toHaveBeenCalledWith(77);
  });

  /**
   * On an asset, `allowNone` already offered an exit (the version hangs off the asset itself).
   * Both coexist: the explanation stays true, and filing the render under a task rather than
   * "on the asset" keeps the step that produced it.
   */
  it('leaves both exits on an asset, without making either disappear', () => {
    mount({ tasks: [], allowNone: true });
    expect(screen.getByText(t('upload.pickTask.barren'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('upload.pickTask.createStepless') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('upload.pickTask.none') })).toBeTruthy();
  });

  it('on a linked project, sends the user to the site rather than creating a duplicate', () => {
    steps.mockReturnValue({ linked: true, steps: [], isLoading: false });
    mount({ tasks: [] });
    expect(screen.getByText(t('upload.pickTask.barrenLinked'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('upload.pickTask.createStepless') })).toBeNull();
  });

  it('waits for the pipeline response before announcing there is nothing', () => {
    steps.mockReturnValue({ linked: false, steps: [], isLoading: true });
    mount({ tasks: [] });
    expect(screen.getByText(t('common.loading'))).toBeTruthy();
    expect(screen.queryByText(t('upload.pickTask.barren'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('upload.pickTask.createStepless') })).toBeNull();
  });

  it('disappears as soon as a step exists: the fallback exit is not a shortcut', () => {
    steps.mockReturnValue({
      linked: false,
      steps: [{ key: 'dept-7', code: 'ANIM', color: null }],
      isLoading: false,
    });
    mount({ tasks: [] });
    expect(screen.queryByText(t('upload.pickTask.barren'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('upload.pickTask.createStepless') })).toBeNull();
    expect(screen.getByLabelText(t('upload.pickTask.namePlaceholder'))).toBeTruthy();
  });
});
