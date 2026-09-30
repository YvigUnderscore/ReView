// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn() } }));
vi.mock('../../lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { noteAsBrief, useCommentTaskDialog } from './useCommentTaskDialog';
import { t } from '../i18n';

/** Deux paragraphes, une entité, et plus de quatre-vingts signes : de quoi voir la coupe. */
const COMMENT = {
  id: 9,
  content:
    '<p>Le raccord saute de deux frames sur la fin, voir la tête de Léa</p>' +
    '<p>Et le halo &amp; le flicker du mur du fond restent à reprendre</p>',
};

const TEXTE =
  'Le raccord saute de deux frames sur la fin, voir la tête de Léa\n' +
  'Et le halo & le flicker du mur du fond restent à reprendre';

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
const briefField = () => screen.getByLabelText<HTMLTextAreaElement>(t('task.description'));

beforeEach(() => {
  vi.clearAllMocks();
  api.post.mockResolvedValue({ task: { id: 50, name: 'Raccord fin de plan' } });
});

afterEach(cleanup);

/**
 * Le retour n'est pas un titre, c'est la consigne (lot 13). Les deux champs étaient à
 * l'envers : le nom arrivait pré-rempli d'un extrait tronqué du retour, et la consigne vide.
 */
describe('useCommentTaskDialog', () => {
  it('ne crée rien avant que le dialogue soit ouvert et validé', () => {
    mount();
    expect(screen.queryByText(t('task.fromComment.title'))).toBeNull();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    expect(screen.getByText(t('task.fromComment.title'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('met le texte du retour dans la consigne, en entier et sans balise', () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    expect(briefField().value).toBe(TEXTE);
  });

  it('laisse le nom vide et lui donne le focus : c’est lui qu’on attend', () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    expect(nameField().value).toBe('');
    expect(document.activeElement).toBe(nameField());
  });

  /** Nom vide : rien ne part, et c'est le champ qui le dit — pas un toast après coup. */
  it('refuse un nom vide, et le champ l’annonce', () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    const submit = screen.getByText<HTMLButtonElement>(t('task.fromComment.submit'));
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(api.post).not.toHaveBeenCalled();
    expect(nameField().required).toBe(true);
    expect(nameField().placeholder).toBe(t('task.fromComment.namePlaceholder'));
    // Un nom d'espaces ne vaut pas mieux qu'un nom vide.
    fireEvent.change(nameField(), { target: { value: '   ' } });
    expect(screen.getByText<HTMLButtonElement>(t('task.fromComment.submit')).disabled).toBe(true);
  });

  it('envoie le nom saisi et la consigne telle qu’elle a été relue', async () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    fireEvent.change(nameField(), { target: { value: '  Raccord fin de plan  ' } });
    fireEvent.change(briefField(), { target: { value: 'Reprendre les deux dernières frames' } });
    fireEvent.click(screen.getByText(t('task.fromComment.submit')));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/comments/9/task', {
        name: 'Raccord fin de plan',
        description: 'Reprendre les deux dernières frames',
      }),
    );
  });

  it('sans toucher à rien, la consigne partante est le retour lui-même', async () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    fireEvent.change(nameField(), { target: { value: 'Raccord fin de plan' } });
    fireEvent.click(screen.getByText(t('task.fromComment.submit')));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/comments/9/task', {
        name: 'Raccord fin de plan',
        description: TEXTE,
      }),
    );
  });

  it('consigne effacée : n’en invente pas une', async () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    fireEvent.change(nameField(), { target: { value: 'Raccord fin de plan' } });
    fireEvent.change(briefField(), { target: { value: '   ' } });
    fireEvent.click(screen.getByText(t('task.fromComment.submit')));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/comments/9/task', {
        name: 'Raccord fin de plan',
        description: null,
      }),
    );
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
    expect(briefField().value).toBe(TEXTE);
  });
});

/**
 * La consigne est du texte simple rendu en `whitespace-pre-wrap` : les frontières de blocs
 * doivent devenir des sauts de ligne, et les entités redevenir des caractères.
 */
describe('noteAsBrief', () => {
  it('coupe les lignes sur les blocs et les `<br>`, décode les entités', () => {
    expect(noteAsBrief('<p>a<br>b</p><ul><li>c</li><li>d</li></ul>')).toBe('a\nb\nc\nd');
    expect(noteAsBrief('<p>2 &lt; 3 &amp; 4 &gt; 1</p>')).toBe('2 < 3 & 4 > 1');
  });

  it('replie les espaces sans écraser les paragraphes, et ne rend rien pour un retour muet', () => {
    expect(noteAsBrief('<p>  deux   espaces </p>\n\n<p>puis\tune tabulation</p>')).toBe(
      'deux espaces\npuis une tabulation',
    );
    expect(noteAsBrief('<p><img src="x" /></p>')).toBe('');
  });

  /** La consigne s'arrête à quatre mille signes côté serveur : on borne avant l'envoi. */
  it('borne le texte à la longueur que le serveur accepte', () => {
    const brief = noteAsBrief(`<p>${'x'.repeat(5000)}</p>`);
    expect(brief).toHaveLength(4000);
  });
});
