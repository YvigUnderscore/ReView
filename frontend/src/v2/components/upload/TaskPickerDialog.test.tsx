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

/** Les tâches de l'asset ouvert — celles que la page a déjà chargées. */
const MINE: PickableTask[] = [
  { id: 41, name: 'Lookdev', department: 'lookdev', pipelineStatusId: null, versionCount: 2 },
];

/**
 * Le reste du projet, du même bord : c'est exactement ce que le dialogue proposait à tort
 * sous « Elsewhere in the project ».
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
 * Le dialogue s'ouvre depuis une entité : proposer les tâches d'une autre invite à ranger
 * la version au mauvais endroit, et ShotGrid la reçoit là-bas — ce qui ne se rattrape pas.
 */
describe('TaskPickerDialog — destinations', () => {
  it('ne propose que les tâches de l’entité ouverte', () => {
    mount();
    expect(screen.getByRole('button', { name: /Lookdev/ })).toBeTruthy();
    // Un autre asset du même bord : c'était la section « ailleurs dans le projet ».
    expect(screen.queryByRole('button', { name: /Layout/ })).toBeNull();
    expect(screen.queryByText(/Train Yard Scan/)).toBeNull();
    // Et, a fortiori, aucune tâche de plan.
    expect(screen.queryByRole('button', { name: /Groom/ })).toBeNull();
    expect(screen.queryByText(/SH010/)).toBeNull();
  });

  it('rend la tâche choisie, celle de l’entité', async () => {
    const user = userEvent.setup();
    const onPick = mount();
    await user.click(screen.getByRole('button', { name: /Lookdev/ }));
    expect(onPick).toHaveBeenCalledWith(41);
  });

  it('laisse rattacher au parent quand la page l’autorise, jamais sinon', () => {
    mount({ allowNone: true });
    expect(screen.getByRole('button', { name: t('upload.pickTask.none') })).toBeTruthy();
  });

  it('n’offre pas le rattachement au parent sans `allowNone`', () => {
    mount();
    expect(screen.queryByRole('button', { name: t('upload.pickTask.none') })).toBeNull();
  });
});

describe('TaskPickerDialog — étape manquante', () => {
  beforeEach(() => {
    steps.mockReturnValue({
      linked: false,
      steps: [{ key: 'dept-7', code: 'ANIM', color: null }],
      isLoading: false,
    });
  });

  it('crée l’étape manquante sur l’entité ouverte', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      screen.getByRole('button', { name: t('upload.pickTask.createStepLocal', { step: 'ANIM' }) }),
    );
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ parent: { kind: 'asset', id: 12 } }));
  });

  it('propose encore les noms du projet en autocomplétion — un nom n’est pas une destination', () => {
    mount();
    const names = [...document.querySelectorAll('#review-task-names option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(names).toContain('Lookdev');
    expect(names).toContain('Layout');
  });
});

/**
 * Aucune tâche sur l'entité ET aucune étape inscriptible : le dialogue rendait alors une
 * boîte vide dont la seule issue était la croix de la modale — donc un dépôt impossible.
 * Le cas n'est pas exotique : rien ne sème de département à l'installation, la politique
 * de département ne laisse d'étape écrivable qu'à qui appartient à l'une d'elles, et un
 * site relié peut n'exposer aucune étape pour ce type d'entité.
 */
describe('TaskPickerDialog — aucune destination', () => {
  beforeEach(() => {
    projectTasks.mockReturnValue({ data: [] });
    steps.mockReturnValue({ linked: false, steps: [], isLoading: false });
  });

  it('ne reste jamais sans issue : la tâche sans étape rouvre le dépôt', async () => {
    const user = userEvent.setup();
    const onPick = mount({ tasks: [], parent: { kind: 'shot', id: 12 } });
    expect(screen.getByText(t('upload.pickTask.barren'))).toBeTruthy();
    const create = screen.getByRole('button', { name: t('upload.pickTask.createStepless') });
    // Sans nom, le serveur refuserait la tâche : le bouton attend qu'on en donne un.
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
   * Sur un asset, `allowNone` offrait déjà une issue (la version pend à l'asset lui-même).
   * Les deux cohabitent : l'explication reste vraie, et ranger le rendu sous une tâche
   * plutôt que « sur l'asset » garde l'étape qui l'a produit.
   */
  it('laisse les deux issues sur un asset, sans en faire disparaître une', () => {
    mount({ tasks: [], allowNone: true });
    expect(screen.getByText(t('upload.pickTask.barren'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('upload.pickTask.createStepless') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('upload.pickTask.none') })).toBeTruthy();
  });

  it('sur un projet relié, renvoie au site plutôt que de créer un doublon', () => {
    steps.mockReturnValue({ linked: true, steps: [], isLoading: false });
    mount({ tasks: [] });
    expect(screen.getByText(t('upload.pickTask.barrenLinked'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('upload.pickTask.createStepless') })).toBeNull();
  });

  it('attend la réponse du pipe avant d’annoncer qu’il n’y a rien', () => {
    steps.mockReturnValue({ linked: false, steps: [], isLoading: true });
    mount({ tasks: [] });
    expect(screen.getByText(t('common.loading'))).toBeTruthy();
    expect(screen.queryByText(t('upload.pickTask.barren'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('upload.pickTask.createStepless') })).toBeNull();
  });

  it('s’efface dès qu’une étape existe : la sortie de secours n’est pas un raccourci', () => {
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
