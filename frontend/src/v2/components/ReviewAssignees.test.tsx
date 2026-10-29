// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import ReviewAssignees from './ReviewAssignees';
import { t } from '../i18n';

/**
 * Entrust a version's review to someone, and tell them what to look at.
 *
 * What is verified: the list can be read by everyone but only written by a
 * manager. A click on a name adds it in one gesture (no "Save" button
 * that one can leave without having seen), and clicking again removes it: the same button must do
 * both, otherwise removing someone would mean searching for where.
 *
 * As for the instruction: the person leaves with theirs, and when the project REQUIRES an
 * instruction, clicking a name does NOT assign them straight away: it puts them on hold while
 * it is written. Assigning first, only to be refused afterwards, would be a false promise.
 */

const PROJECT = {
  project: {
    id: 7,
    myRole: 'SUPERVISOR',
    memberships: [
      { role: 'ARTIST', user: { id: 4, name: 'Alice', email: 'alice@studio.test', role: 'ARTIST' } },
      { role: 'ARTIST', user: { id: 5, name: 'Bruno', email: 'bruno@studio.test', role: 'ARTIST' } },
    ],
  },
};

const reviewer = (id: number, name: string, note: string | null = null) => ({
  id,
  name,
  firstName: null,
  lastName: null,
  username: null,
  avatarUrl: null,
  note,
});

/** Project settings: by default, no instruction is required. */
const settings = (requireNote = false) => ({
  settings: { reviewRequest: { requireNote, minNoteLength: 5 } },
});

describe('ReviewAssignees', () => {
  it('says that nobody is in charge of the review, and offers to load one', async () => {
    renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(),
        'GET /api/versions/:id/reviewers': { reviewers: [] },
      },
    });
    expect(await screen.findByText(t('reviewers.none'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('reviewers.assign') })).toBeTruthy();
  });

  it('without the right to assign: the list can be read, the button does not exist', async () => {
    renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign={false} />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(),
        'GET /api/versions/:id/reviewers': { reviewers: [reviewer(4, 'Alice', 'la lumière')] },
      },
    });
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('reviewers.assign') })).toBeNull();
  });

  it('a click on a name adds it to the list sent', async () => {
    const { user, api } = renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(),
        'GET /api/versions/:id/reviewers': { reviewers: [] },
        'PUT /api/versions/:id/reviewers': { reviewers: [reviewer(5, 'Bruno')] },
      },
    });
    await user.click(await screen.findByRole('button', { name: t('reviewers.assign') }));
    await user.click(await screen.findByText('Bruno'));
    await waitFor(() => expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(1));
    expect(api.called('PUT /api/versions/:id/reviewers')[0].body).toEqual({
      reviewers: [{ userId: 5, note: null }],
    });
  });

  it('clicking an already loaded person again removes them: their instruction leaves with them', async () => {
    const { user, api } = renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(),
        'GET /api/versions/:id/reviewers': {
          reviewers: [reviewer(4, 'Alice'), reviewer(5, 'Bruno', 'le raccord')],
        },
        'PUT /api/versions/:id/reviewers': { reviewers: [reviewer(5, 'Bruno', 'le raccord')] },
      },
    });
    await user.click(await screen.findByRole('button', { name: t('reviewers.assign') }));
    // By ROLE: "Alice" also appears in her instruction row, which is not a
    // button: it is the directory's one we want to click again.
    await user.click(await screen.findByRole('button', { name: /Alice/ }));
    await waitFor(() => expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(1));
    // Bruno stays, WITH his instruction: a replacement that forgot it would erase it.
    expect(api.called('PUT /api/versions/:id/reviewers')[0].body).toEqual({
      reviewers: [{ userId: 5, note: 'le raccord' }],
    });
  });

  it('mandatory instruction: clicking a name puts the person on hold, without writing anything', async () => {
    const { user, api } = renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(true),
        'GET /api/versions/:id/reviewers': { reviewers: [] },
        'PUT /api/versions/:id/reviewers': { reviewers: [reviewer(5, 'Bruno', 'la lumière')] },
      },
    });
    await user.click(await screen.findByRole('button', { name: t('reviewers.assign') }));
    await user.click(await screen.findByText('Bruno'));
    // Nothing left: the server would have refused, and the screen would have learned too late.
    expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(0);
    expect(screen.getByText(t('reviewers.noteRequired'))).toBeTruthy();

    await user.type(screen.getByLabelText(t('reviewers.noteLabel', { name: 'Bruno' })), 'la lumière');
    await user.click(screen.getByRole('button', { name: t('reviewers.confirm') }));
    await waitFor(() => expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(1));
    expect(api.called('PUT /api/versions/:id/reviewers')[0].body).toEqual({
      reviewers: [{ userId: 5, note: 'la lumière' }],
    });
  });
});
