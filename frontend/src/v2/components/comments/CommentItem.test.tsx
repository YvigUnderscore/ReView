// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { stubLayoutMetrics } from '../../../test/layoutMetrics';
import type { ReviewComment } from '../../types/api';
import CommentItem from './CommentItem';
import { VISIBLE_REPLIES } from './collapse';
import { t } from '../../i18n';

const base = (id: number, content: string, patch: Partial<ReviewComment> = {}): ReviewComment => ({
  id,
  content,
  timestamp: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  author: { id: 1, name: 'Ada', displayName: 'Ada', initials: 'AD', avatarUrl: null },
  guestName: null,
  cameraState: null,
  annotation: null,
  isEdited: false,
  isResolved: false,
  ...patch,
});

const mount = (comment: ReviewComment) =>
  renderWithProviders(
    <CommentItem
      comment={comment}
      mediaObjectId={9}
      currentUserId={1}
      currentUserRole="ADMIN"
      reload={vi.fn()}
      fps={24}
      startFrame={1001}
      selectedId={null}
      onSelect={vi.fn()}
    />,
  );

/**
 * D6 — un fil à cent réponses était rendu en entier. On ne garde que les dernières, et
 * l'indicateur dit combien il en cache : sans ce chiffre, le bouton ne se comprend pas.
 */
describe('CommentItem — fil long', () => {
  const withReplies = (n: number) =>
    base(1, 'racine', {
      replies: Array.from({ length: n }, (_, i) => base(100 + i, `reponse-${i}`)),
    });

  it('rend tout un fil court, sans indicateur', () => {
    mount(withReplies(VISIBLE_REPLIES));
    expect(screen.getAllByText(/^reponse-/)).toHaveLength(VISIBLE_REPLIES);
    expect(
      screen.queryByRole('button', { name: t('comments.showEarlierReplies', { count: 1 }) }),
    ).not.toBeInTheDocument();
  });

  it('borne les réponses rendues et annonce celles qu’il cache', () => {
    mount(withReplies(VISIBLE_REPLIES + 5));
    expect(screen.getAllByText(/^reponse-/)).toHaveLength(VISIBLE_REPLIES);
    // Les plus anciennes sont celles qui manquent ; les dernières restent visibles.
    expect(screen.queryByText('reponse-0')).not.toBeInTheDocument();
    expect(screen.getByText(`reponse-${VISIBLE_REPLIES + 4}`)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('comments.showEarlierReplies', { count: 5 }) }),
    ).toBeInTheDocument();
  });

  it('déplie le fil entier au clic, puis le replie', async () => {
    const { user } = mount(withReplies(VISIBLE_REPLIES + 5));
    await user.click(screen.getByRole('button', { name: t('comments.showEarlierReplies', { count: 5 }) }));
    expect(screen.getAllByText(/^reponse-/)).toHaveLength(VISIBLE_REPLIES + 5);
    await user.click(screen.getByRole('button', { name: t('comments.hideEarlierReplies') }));
    expect(screen.getAllByText(/^reponse-/)).toHaveLength(VISIBLE_REPLIES);
  });
});

/**
 * Le repliage d'un commentaire se décide sur ce que la colonne masque VRAIMENT : happy-dom ne
 * met rien en page, on lui prête donc la largeur d'un panneau de review.
 */
describe('CommentItem — commentaire trop grand', () => {
  const wall = 'z'.repeat(640);

  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });
  const layout = () => {
    restore = stubLayoutMetrics({ charsPerLine: 40 });
  };

  it('replie un mur de texte en gardant le texte trouvable', () => {
    layout();
    mount(base(1, wall));
    expect(
      screen.getByRole('button', { name: t('comments.expandComment', { count: wall.length }) }),
    ).toBeInTheDocument();
    expect(screen.getByText(wall)).toBeInTheDocument();
  });

  it('laisse un commentaire court intact', () => {
    layout();
    mount(base(1, 'trop sombre'));
    expect(screen.queryByRole('button', { name: t('comments.collapseComment') })).not.toBeInTheDocument();
  });
});

/**
 * Lot 14 — une proposition d'édition de nuage dépose son masque et ses ops de sous-ensemble en
 * pièces jointes du commentaire : c'est ce qui leur donne le stockage, la présignature et la
 * purge. Ce ne sont pas pour autant des fichiers offerts au lecteur — un bitset ne s'ouvre pas.
 * La liste des pièces jointes les écarte par leur CLÉ, jamais par leur type : un `.bin` que
 * quelqu'un joint vraiment reste proposé.
 */
describe('CommentItem — binaires d’une proposition de nuage', () => {
  const withProposal = () =>
    base(1, 'nettoyage proposé', {
      annotation: [
        {
          type: 'splat-edit',
          transform: null,
          volumes: [],
          mask: { key: 'comments/attachments/1/mask.bin', count: 12 },
          subset: null,
        },
      ],
      attachments: [
        {
          key: 'comments/attachments/1/mask.bin',
          name: 'splat-mask.bin',
          contentType: 'application/octet-stream',
          url: 'u1',
        },
        {
          key: 'comments/attachments/1/notes.pdf',
          name: 'notes.pdf',
          contentType: 'application/pdf',
          url: 'u2',
        },
      ],
    });

  it('n’affiche pas le masque déposé pour la proposition', () => {
    stubLayoutMetrics({ charsPerLine: 60 });
    mount(withProposal());
    expect(screen.queryByText('splat-mask.bin')).toBeNull();
  });

  it('laisse les vraies pièces jointes du commentaire', () => {
    stubLayoutMetrics({ charsPerLine: 60 });
    mount(withProposal());
    expect(screen.getByText('notes.pdf')).toBeTruthy();
  });
});
