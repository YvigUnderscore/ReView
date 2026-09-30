// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { patch: vi.fn() } }));
vi.mock('../../../lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import TaskDescription from './TaskDescription';
import { t } from '../../i18n';

const mount = (description: string | null, canEdit: boolean) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TaskDescription taskId={7} description={description} canEdit={canEdit} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  api.patch.mockResolvedValue({ task: { id: 7 } });
});

afterEach(cleanup);

/**
 * La consigne d'une tâche (Phase 50) : le modèle n'avait aucun champ de description, et
 * l'artiste lisait le nom de l'étape en devinant le reste.
 */
describe('TaskDescription', () => {
  it('reste muette quand il n’y a rien à lire et rien à écrire', () => {
    const view = mount(null, false);
    expect(view.container.textContent).toBe('');
  });

  it('montre la consigne à qui ne peut pas l’écrire, sans la rendre cliquable', () => {
    mount('Halo trop chaud sur les 12 dernières frames', false);
    expect(screen.getByText(/Halo trop chaud/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('propose de l’écrire quand elle est vide, et l’enregistre', async () => {
    mount(null, true);
    fireEvent.click(screen.getByText(t('task.descriptionEmpty')));
    fireEvent.change(screen.getByPlaceholderText(t('task.descriptionPlaceholder')), {
      target: { value: '  Reprendre le halo  ' },
    });
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/tasks/7', { description: 'Reprendre le halo' }),
    );
  });

  /** Vider la consigne est une modification comme une autre : elle part en `null`. */
  it('vide la consigne en l’effaçant', async () => {
    mount('À reprendre', true);
    fireEvent.click(screen.getByText('À reprendre'));
    fireEvent.change(screen.getByPlaceholderText(t('task.descriptionPlaceholder')), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/tasks/7', { description: null }));
  });

  it('n’envoie rien quand le texte n’a pas changé', async () => {
    mount('À reprendre', true);
    fireEvent.click(screen.getByText('À reprendre'));
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() => expect(screen.getByText('À reprendre')).toBeTruthy());
    expect(api.patch).not.toHaveBeenCalled();
  });
});
