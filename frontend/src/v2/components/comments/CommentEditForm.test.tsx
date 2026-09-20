// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useProjectContext } from '../../stores/useProjectContext';
import type { ReviewComment } from '../../types/api';
import CommentEditForm from './CommentEditForm';
import { t } from '../../i18n';

const MINE = 'comments/attachments/1/1700-planche.png';
const FROM_SHOTGRID = 'comments/attachments/shotgrid/12/9-note.png';
const UPLOADED = 'comments/attachments/1/1800-nouvelle.png';

const comment = (patch: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 12,
  content: 'Trop sombre',
  timestamp: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  author: { id: 1, name: 'Ada', displayName: 'Ada', initials: 'AD', avatarUrl: null },
  guestName: null,
  cameraState: null,
  annotation: null,
  isEdited: false,
  isResolved: false,
  attachments: [
    { key: MINE, name: 'planche.png', contentType: 'image/png', url: 'https://minio/planche' },
    { key: FROM_SHOTGRID, name: 'note.png', contentType: 'image/png', url: 'https://minio/note' },
  ],
  ...patch,
});

/** Routes minimales de l'édition : présignature, dépôt MinIO, PATCH du commentaire. */
const routes = {
  'POST /api/comments/attachments/presign': { url: 'https://minio/put', key: UPLOADED },
  'PUT /put': {},
  'PATCH /api/comments/:id': ({ body }: { body: unknown }) => ({
    comment: { ...comment(), ...(body as object) },
  }),
};

const mount = (patch: Partial<ReviewComment> = {}) =>
  renderWithProviders(
    <CommentEditForm comment={comment(patch)} mediaObjectId={9} onDone={vi.fn()} onCancel={vi.fn()} />,
    { api: routes },
  );

/** Clés envoyées par le dernier PATCH, dans l'ordre. */
const patchedKeys = (api: ReturnType<typeof mount>['api']) => {
  const body = api.called('PATCH /api/comments/:id').at(-1)?.body as
    { attachments?: { key: string }[] } | undefined;
  return body?.attachments?.map((a) => a.key);
};

afterEach(() => {
  useProjectContext.setState({ projectId: null });
});

/**
 * D5 — le `PATCH` d'édition ne connaissait pas `attachments` : on ne pouvait ni ajouter ni
 * retirer une image en corrigeant un commentaire. On vérifie donc la liste effectivement
 * envoyée, puisque c'est elle qui décide de ce qui reste dans le fil et dans le stockage.
 */
describe('CommentEditForm — pièces jointes éditables', () => {
  it('montre les images déjà jointes, en vignettes', () => {
    mount();
    expect(screen.getByRole('img', { name: 'planche.png' })).toHaveAttribute('src', 'https://minio/planche');
    expect(screen.getByRole('img', { name: 'note.png' })).toBeInTheDocument();
  });

  it('renvoie les deux clés inchangées quand on ne touche à rien', async () => {
    const { api, user } = mount();
    await user.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(patchedKeys(api)).toEqual([MINE, FROM_SHOTGRID]));
  });

  it('retire une image de la liste envoyée, et conserve celle venue de ShotGrid', async () => {
    const { api, user } = mount();
    await user.click(screen.getAllByRole('button', { name: t('comments.removeAttachment') })[0]);
    expect(screen.queryByRole('img', { name: 'planche.png' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(patchedKeys(api)).toEqual([FROM_SHOTGRID]));
  });

  it('ajoute une image : elle est téléversée puis jointe à la liste', async () => {
    const { api, user, container } = mount();
    const file = new File(['x'], 'nouvelle.png', { type: 'image/png' });
    // Le champ de fichier est masqué derrière son bouton : on le pilote directement, comme
    // le navigateur le fait après le sélecteur de fichiers.
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    // Vignette locale immédiate : on voit ce qu'on ajoute avant même le téléversement.
    expect(await screen.findByRole('img', { name: 'nouvelle.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(patchedKeys(api)).toEqual([MINE, FROM_SHOTGRID, UPLOADED]));
    expect(api.called('POST /api/comments/attachments/presign')).toHaveLength(1);
  });

  it("n'envoie jamais l'URL présignée, seulement la clé et ses étiquettes", async () => {
    const { api, user } = mount();
    await user.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(patchedKeys(api)).toHaveLength(2));
    const body = api.called('PATCH /api/comments/:id').at(-1)?.body as {
      attachments: Record<string, unknown>[];
    };
    expect(Object.keys(body.attachments[0]).sort()).toEqual(['contentType', 'key', 'name']);
  });

  it('laisse enregistrer un commentaire dont on a tout retiré, si le texte reste', async () => {
    const { api, user } = mount();
    const crosses = screen.getAllByRole('button', { name: t('comments.removeAttachment') });
    await user.click(crosses[0]);
    await user.click(screen.getAllByRole('button', { name: t('comments.removeAttachment') })[0]);
    await user.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(patchedKeys(api)).toEqual([]));
  });

  /** Le serveur exige un contenu : une note réduite à ses images ne doit pas repartir en 400. */
  it('garde un contenu minimal quand on efface le texte mais garde les images', async () => {
    const { api, user } = mount();
    await user.clear(screen.getByLabelText(t('comments.editField')));
    await user.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(patchedKeys(api)).toHaveLength(2));
    expect((api.called('PATCH /api/comments/:id').at(-1)?.body as { content: string }).content).not.toBe('');
  });

  it('refuse d’enregistrer un commentaire vide de texte ET de pièces', async () => {
    const { user } = mount({ attachments: [] });
    await user.clear(screen.getByLabelText(t('comments.editField')));
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled();
  });
});

/**
 * Le bloc d'édition perdait l'autocomplétion `@mention` offerte à la saisie et à la réponse :
 * citer quelqu'un en corrigeant sa note supposait de taper le pseudo exact de mémoire.
 */
describe('CommentEditForm — mentions', () => {
  it("propose les membres du projet dès qu'on tape un @", async () => {
    useProjectContext.setState({ projectId: 3 });
    const { user } = renderWithProviders(
      <CommentEditForm comment={comment()} mediaObjectId={9} onDone={vi.fn()} onCancel={vi.fn()} />,
      {
        api: {
          ...routes,
          'GET /api/projects/3': {
            project: {
              memberships: [{ user: { id: 7, username: 'yvig', email: 'y@s.fr', name: 'Yvig B' } }],
            },
          },
        },
      },
    );
    const field = screen.getByLabelText(t('comments.editField'));
    await user.click(field);
    await user.keyboard(' @yv');
    expect(await screen.findByRole('button', { name: /yvig/ })).toBeInTheDocument();
  });
});
