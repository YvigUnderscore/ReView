// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import ClientSharePage from '../../v2/pages/ClientSharePage';
import type { ClientMedia, ClientSharePayload } from '../../v2/types/api';
import { t } from '../../v2/i18n';
import { httpError, type MockResolver } from '../apiMock';
import { textIncluding } from '../text';
import { renderWithProviders } from '../renderWithProviders';

/**
 * Client sharing is the only surface that someone outside the studio sees. Three
 * things must never escape it: a dead link must say so (and be distinguished from a
 * reached quota), a read-only link must not offer to write, and a media that the
 * browser cannot open must produce a message for the viewer, not the internal instruction to
 * restart a conversion meant for an artist.
 */

const TOKEN = 'share-token';

const media: ClientMedia = {
  id: 5,
  kind: 'MODEL_3D',
  originalName: 'ship_v003.glb',
  thumbnailUrl: null,
  createdAt: '2026-09-16T00:00:00.000Z',
  version: { id: 50, name: 'V03', taskName: null },
  decided: false,
  placement: { episodeId: null, sequenceId: null, shotId: null, assetId: 90 },
};

const payload = (patch: Partial<ClientSharePayload> = {}): ClientSharePayload => ({
  locked: false,
  studio: { name: 'Studio Nord', logoUrl: null },
  project: { id: 1, name: 'Alpha', description: null, status: 'ACTIVE', episodesEnabled: false },
  permission: 'COMMENT',
  media: [media],
  ...patch,
});

const mount = (api: Record<string, MockResolver>) =>
  renderWithProviders(<ClientSharePage />, {
    route: `/client/${TOKEN}`,
    path: '/client/:token',
    user: null,
    api,
  });

describe('ClientSharePage', () => {
  it('distinguishes a revoked link from one that has used up its views', async () => {
    const { unmount } = mount({ [`GET /api/client/${TOKEN}`]: httpError(404, 'gone') });
    expect(await screen.findByText(t('share.invalid'))).toBeInTheDocument();
    unmount();

    mount({ [`GET /api/client/${TOKEN}`]: httpError(410, 'view limit') });
    expect(await screen.findByText(t('share.viewLimit'))).toBeInTheDocument();
  });

  it('asks for the password before showing anything', async () => {
    mount({
      [`GET /api/client/${TOKEN}`]: payload({ locked: true, media: undefined, project: undefined }),
    });

    expect(await screen.findByText(t('client.passwordProtected'))).toBeInTheDocument();
    expect(screen.queryByText(media.originalName)).not.toBeInTheDocument();
  });

  it('opens the review after unlocking and keeps the sharing session', async () => {
    let locked = true;
    const { user, api } = mount({
      [`GET /api/client/${TOKEN}`]: () =>
        locked
          ? payload({ locked: true, media: undefined, project: undefined })
          : payload({ shareAuth: 'share-session' }),
      [`POST /api/client/${TOKEN}/unlock`]: () => {
        locked = false;
        return { shareAuth: 'share-session' };
      },
    });

    await user.type(await screen.findByPlaceholderText(t('login.password')), 'secret-phrase');
    await user.click(screen.getByRole('button', { name: t('client.enter') }));

    expect(await screen.findByText(media.originalName)).toBeInTheDocument();
    expect(sessionStorage.getItem(`share-auth:${TOKEN}`)).toBe('share-session');
    // The session travels in a header, never in the URL.
    expect(api.called(`GET /api/client/${TOKEN}`).at(-1)?.url.search).toBe('');
  });

  it('tells the visitor, in plain words, that a media cannot be opened here', async () => {
    const { user } = mount({
      [`GET /api/client/${TOKEN}`]: payload(),
      [`GET /api/client/${TOKEN}/media/5/url`]: httpError(422, 'no viewable derivative'),
      [`GET /api/client/${TOKEN}/media/5/comments`]: { comments: [] },
    });

    await user.click(await screen.findByRole('button', { name: new RegExp(media.originalName) }));

    const notice = await screen.findByText(textIncluding(t('client.mediaUnavailable')));
    expect(notice).toHaveTextContent(t('client.contactStudio'));
    // No internal instruction ("restart the conversion") leaks to the client.
    expect(screen.queryByRole('button', { name: t('model3d.reconvert') })).not.toBeInTheDocument();
  });

  it('does not offer to write on a read-only link', async () => {
    const { user } = mount({
      [`GET /api/client/${TOKEN}`]: payload({ permission: 'VIEW' }),
      [`GET /api/client/${TOKEN}/media/5/url`]: httpError(422, 'no viewable derivative'),
      [`GET /api/client/${TOKEN}/media/5/comments`]: { comments: [] },
    });

    await user.click(await screen.findByRole('button', { name: new RegExp(media.originalName) }));

    await screen.findByText(textIncluding(t('client.mediaUnavailable')));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('announces an empty selection rather than a blank page', async () => {
    mount({ [`GET /api/client/${TOKEN}`]: payload({ media: [] }) });

    expect(await screen.findByText(t('client.noPublished'))).toBeInTheDocument();
  });
});
