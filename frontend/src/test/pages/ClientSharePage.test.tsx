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
 * Le partage client est la seule surface que voit quelqu'un d'extérieur au studio. Trois
 * choses ne doivent jamais lui échapper : un lien mort doit se dire (et se distinguer d'un
 * quota atteint), un lien en lecture seule ne doit pas offrir d'écrire, et un média que le
 * navigateur ne sait pas ouvrir doit produire un message pour lui — pas la consigne de
 * relance de conversion destinée à un artiste.
 */

const TOKEN = 'share-token';

const media: ClientMedia = { id: 5, kind: 'MODEL_3D', originalName: 'ship_v003.glb', thumbnailUrl: null };

const payload = (patch: Partial<ClientSharePayload> = {}): ClientSharePayload => ({
  locked: false,
  studio: { name: 'Studio Nord', logoUrl: null },
  project: { id: 1, name: 'Alpha', description: null, status: 'ACTIVE' },
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
  it('distingue un lien révoqué d’un lien qui a épuisé ses vues', async () => {
    const { unmount } = mount({ [`GET /api/client/${TOKEN}`]: httpError(404, 'gone') });
    expect(await screen.findByText(t('share.invalid'))).toBeInTheDocument();
    unmount();

    mount({ [`GET /api/client/${TOKEN}`]: httpError(410, 'view limit') });
    expect(await screen.findByText(t('share.viewLimit'))).toBeInTheDocument();
  });

  it('demande le mot de passe avant de montrer quoi que ce soit', async () => {
    mount({
      [`GET /api/client/${TOKEN}`]: payload({ locked: true, media: undefined, project: undefined }),
    });

    expect(await screen.findByText(t('client.passwordProtected'))).toBeInTheDocument();
    expect(screen.queryByText(media.originalName)).not.toBeInTheDocument();
  });

  it('ouvre la review après le déverrouillage et garde la session de partage', async () => {
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
    // La session voyage en en-tête, jamais dans l'URL.
    expect(api.called(`GET /api/client/${TOKEN}`).at(-1)?.url.search).toBe('');
  });

  it('dit au visiteur, dans ses mots, qu’un média ne s’ouvre pas ici', async () => {
    const { user } = mount({
      [`GET /api/client/${TOKEN}`]: payload(),
      [`GET /api/client/${TOKEN}/media/5/url`]: httpError(422, 'no viewable derivative'),
      [`GET /api/client/${TOKEN}/media/5/comments`]: { comments: [] },
    });

    await user.click(await screen.findByRole('button', { name: new RegExp(media.originalName) }));

    const notice = await screen.findByText(textIncluding(t('client.mediaUnavailable')));
    expect(notice).toHaveTextContent(t('client.contactStudio'));
    // Aucune consigne interne (« relancer la conversion ») ne fuit vers le client.
    expect(screen.queryByRole('button', { name: t('model3d.reconvert') })).not.toBeInTheDocument();
  });

  it('n’offre pas d’écrire sur un lien en lecture seule', async () => {
    const { user } = mount({
      [`GET /api/client/${TOKEN}`]: payload({ permission: 'VIEW' }),
      [`GET /api/client/${TOKEN}/media/5/url`]: httpError(422, 'no viewable derivative'),
      [`GET /api/client/${TOKEN}/media/5/comments`]: { comments: [] },
    });

    await user.click(await screen.findByRole('button', { name: new RegExp(media.originalName) }));

    await screen.findByText(textIncluding(t('client.mediaUnavailable')));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('annonce une sélection vide plutôt qu’une page blanche', async () => {
    mount({ [`GET /api/client/${TOKEN}`]: payload({ media: [] }) });

    expect(await screen.findByText(t('client.noPublished'))).toBeInTheDocument();
  });
});
