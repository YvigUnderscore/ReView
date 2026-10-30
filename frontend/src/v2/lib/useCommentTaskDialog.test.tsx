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

/** Two paragraphs, one entity, and over eighty characters: enough to see the cut. */
const COMMENT = {
  id: 9,
  content:
    '<p>Le raccord saute de deux frames sur la fin, voir la tête de Léa</p>' +
    '<p>Et le halo &amp; le flicker du mur du fond restent à reprendre</p>',
};

const TEXTE =
  'Le raccord saute de deux frames sur la fin, voir la tête de Léa\n' +
  'Et le halo & le flicker du mur du fond restent à reprendre';

/** A minimal screen: the button a comment thread would render, and the dialog. */
function Harness() {
  const { open, dialog } = useCommentTaskDialog();
  return (
    <>
      <button onClick={() => open(COMMENT)}>{t('comments.toTask')}</button>
      {dialog}
    </>
  );
}

/** The dialog navigates to the created task: it needs a router above it. */
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
 * The feedback is not a title, it is the instruction (batch 13). The two fields were
 * the wrong way round: the name arrived pre-filled with a truncated extract of the feedback, and the instruction empty.
 */
describe('useCommentTaskDialog', () => {
  it('creates nothing until the dialog is opened and confirmed', () => {
    mount();
    expect(screen.queryByText(t('task.fromComment.title'))).toBeNull();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    expect(screen.getByText(t('task.fromComment.title'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('puts the feedback text into the instruction, in full and without tags', () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    expect(briefField().value).toBe(TEXTE);
  });

  it('leaves the name empty and focuses it: it is what is expected', () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    expect(nameField().value).toBe('');
    expect(document.activeElement).toBe(nameField());
  });

  /** Empty name: nothing is sent, and the field says so — not a toast after the fact. */
  it('refuses an empty name, and the field says so', () => {
    mount();
    fireEvent.click(screen.getByText(t('comments.toTask')));
    const submit = screen.getByText<HTMLButtonElement>(t('task.fromComment.submit'));
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(api.post).not.toHaveBeenCalled();
    expect(nameField().required).toBe(true);
    expect(nameField().placeholder).toBe(t('task.fromComment.namePlaceholder'));
    // A name made of spaces is no better than an empty name.
    fireEvent.change(nameField(), { target: { value: '   ' } });
    expect(screen.getByText<HTMLButtonElement>(t('task.fromComment.submit')).disabled).toBe(true);
  });

  it('sends the typed name and the instruction as reviewed', async () => {
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

  it('without touching anything, the outgoing instruction is the feedback itself', async () => {
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

  it('instruction cleared: does not invent one', async () => {
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
   * The name already taken at this step is the expected error: the dialog must stay open,
   * with the input, so that changing it is enough.
   */
  it('stays open when the server refuses the name', async () => {
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
 * The instruction is plain text rendered with `whitespace-pre-wrap`: block boundaries
 * must become line breaks, and entities must turn back into characters.
 */
describe('noteAsBrief', () => {
  it('breaks lines at blocks and `<br>`, decodes entities', () => {
    expect(noteAsBrief('<p>a<br>b</p><ul><li>c</li><li>d</li></ul>')).toBe('a\nb\nc\nd');
    expect(noteAsBrief('<p>2 &lt; 3 &amp; 4 &gt; 1</p>')).toBe('2 < 3 & 4 > 1');
  });

  it('collapses spaces without flattening paragraphs, and returns nothing for a silent feedback', () => {
    expect(noteAsBrief('<p>  deux   espaces </p>\n\n<p>puis\tune tabulation</p>')).toBe(
      'deux espaces\npuis une tabulation',
    );
    expect(noteAsBrief('<p><img src="x" /></p>')).toBe('');
  });

  /** The instruction stops at four thousand characters server-side: we bound it before sending. */
  it('bounds the text to the length the server accepts', () => {
    const brief = noteAsBrief(`<p>${'x'.repeat(5000)}</p>`);
    expect(brief).toHaveLength(4000);
  });
});
