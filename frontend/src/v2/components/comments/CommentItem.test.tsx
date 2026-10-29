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
 * D6: a thread with a hundred replies was rendered in full. Only the latest are kept, and the
 * indicator says how many are hidden: without this count, the button makes no sense.
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
    // The oldest are the ones missing; the latest stay visible.
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
 * A comment's collapse is decided by what the column ACTUALLY hides: happy-dom does no layout,
 * so it is given the width of a review panel.
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
 * Batch 14: a cloud edit proposal stores its mask and subset ops as comment attachments: that is
 * what gives them storage, presigning and purging. They are not files offered to the reader,
 * though, since a bitset cannot be opened. The attachment list excludes them by their KEY,
 * never by their type: a `.bin` that someone really attaches stays listed.
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
