// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn() } }));
vi.mock('../../lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useCommentTaskDialog } from './useCommentTaskDialog';
import { t } from '../i18n';

const COMMENT = { id: 9, content: '<p>Le raccord saute de deux frames sur la fin</p>' };

/** Un écran minimal : le bouton qu'un fil de commentaires poserait, et le dialogue. */
function Harness() {
  const { open, dialog } = useCommentTaskDialog();
  return (
    <>
      <button onClick={() => open(COMMENT)}>{t('comments.toTask')}</button>
      {dialog}
    </>
  );
}

/** Le dialogue navigue vers la tâche créée : il lui faut un routeur au-dessus. */
const mount = () =>
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );

const nameField = () => screen.getByLabelText<HTMLInputElement>(t('task.nameLabel'));

beforeEach(() => {
  vi.clearAllMocks();
  api.post.mockResolvedValue({ task: { id: 50, name: 'Raccord fin de plan' } });
});

afterEach(cleanup);

/**
 * Le nom était imposé — le texte du retour, tronqué — et c'est lui que la production relit
 * sur le kanban puis sur le site ShotGrid (Phase 50). On le demande donc avant de créer.
 */
describe('useCommentTaskDialog', () => {
  it('ne crée rien avant que le dialogue soit ouvert et validé', () => {
    mount();
    expect(screen.queryByText(t('task.fromComment.title'))).toBeNull();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    expect(screen.getByText(t('task.fromComment.title'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('propose le texte du retour en point de départ, débarrassé de son HTML', () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    expect(nameField().value).toBe('Le raccord saute de deux frames sur la fin');
  });

  it('envoie le nom choisi et la consigne', async () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    fireEvent.change(nameField(), { target: { value: '  Raccord fin de plan  ' } });
    fireEvent.change(screen.getByPlaceholderText(t('task.descriptionPlaceholder')), {
      target: { value: 'Reprendre les deux dernières frames' },
    });
    fireEvent.click(screen.getByText(t('task.fromComment.submit')));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/comments/9/task', {
        name: 'Raccord fin de plan',
        description: 'Reprendre les deux dernières frames',
      }),
    );
  });

  it('sans consigne, n’en invente pas', async () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    fireEvent.click(screen.getByText(t('task.fromComment.submit')));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/comments/9/task', {
        name: 'Le raccord saute de deux frames sur la fin',
        description: null,
      }),
    );
  });

  /** Nom vide : rien ne part, et le bouton ne peut pas être actionné. */
  it('refuse un nom vide', () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    fireEvent.change(nameField(), { target: { value: '   ' } });
    const submit = screen.getByText<HTMLButtonElement>(t('task.fromComment.submit'));
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(api.post).not.toHaveBeenCalled();
  });

  /**
   * Le nom déjà pris à cette étape est la faute attendue : le dialogue doit rester ouvert,
   * avec la saisie, pour qu'il suffise d'en changer.
   */
  it('reste ouvert quand le serveur refuse le nom', async () => {
    api.post.mockRejectedValue(new Error(t('error.TASK_NAME_TAKEN')));
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    fireEvent.change(nameField(), { target: { value: 'Raccord' } });
    fireEvent.click(screen.getByText(t('task.fromComment.submit')));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(nameField().value).toBe('Raccord');
  });
});
