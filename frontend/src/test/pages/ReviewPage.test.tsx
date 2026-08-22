// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReviewPage from '../../v2/pages/ReviewPage';
import type { MediaKind, ReviewComment } from '../../v2/types/api';
import type { MediaResp } from '../../v2/pages/review/reviewTypes';
import { t } from '../../v2/i18n';
import { httpError, type MockResolver } from '../apiMock';
import { renderWithProviders } from '../renderWithProviders';

/**
 * Spark charge son module WebAssembly au premier montage du viewer splat, en allant le
 * chercher par `fetch` : sous happy-dom il reçoit la réponse du bouchon HTTP et se rejette
 * hors de tout test. Le module est donc remplacé — c'est un moteur de rendu, il n'a rien à
 * dire sur *quel* viewer la page choisit, qui est ce que ce fichier vérifie. Les tests du
 * splat lui-même (SPZ, sélection, effets) restent à côté de leur code.
 */
vi.mock('@sparkjsdev/spark', () => ({
  SplatMesh: class {},
  SparkRenderer: class {},
  SpzReader: class {},
  SpzWriter: class {},
  RgbaArray: class {},
  dyno: {},
}));

/**
 * La review monte quatre viewers très différents derrière une seule URL. La régression qui
 * coûte le plus cher n'est pas visuelle : c'est le mauvais viewer, ou aucun. On vérifie donc
 * pour chaque `kind` que la page monte l'outillage de ce type-là *et pas* celui d'un autre,
 * puis que le fil de commentaires vit à côté, quel que soit le média.
 */

const MEDIA_ID = 9;

const mediaResp = (kind: MediaKind, patch: Partial<MediaResp> = {}): MediaResp => ({
  sourceFilename: null,
  media: {
    id: MEDIA_ID,
    kind,
    originalName: 'shot010_comp_v003.mov',
    status: 'READY',
    published: false,
    versionId: 3,
    uploaderId: 1,
  },
  projectId: 2,
  url: 'https://storage.invalid/media.bin',
  thumbnailUrl: null,
  proxyUrl: null,
  glbUrl: kind === 'MODEL_3D' ? 'https://storage.invalid/model.glb' : null,
  startFrame: 1001,
  modelSource: null,
  processingError: null,
  usdOverride: null,
  fps: 24,
  liveSyncHz: 2,
  splatEdits: null,
  splatMaskUrl: null,
  splatMaskCount: 0,
  splatSubsetUrl: null,
  splatSubsetCount: 0,
  splatPresentation: null,
  projectDefaultLighting: null,
  projectColor: null,
  trim: null,
  trimProxyReady: false,
  hls: null,
  timelineSprite: null,
  timelineSpriteUrl: null,
  references: [],
  ...patch,
});

const comment = (patch: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 1,
  content: 'Le raccord de lumière saute au plan suivant',
  timestamp: 12,
  createdAt: '2026-08-20T09:00:00.000Z',
  author: { id: 4, name: 'Lea Nord', displayName: 'Lea', initials: 'LN', avatarUrl: null },
  guestName: null,
  cameraState: null,
  annotation: null,
  isEdited: false,
  isResolved: false,
  ...patch,
});

const mount = (kind: MediaKind, extra: Record<string, MockResolver> = {}) =>
  renderWithProviders(<ReviewPage />, {
    route: `/review/${MEDIA_ID}`,
    path: '/review/:mediaId',
    api: {
      [`GET /api/media/${MEDIA_ID}`]: mediaResp(kind),
      'GET /api/comments': { items: [] },
      [`GET /api/context/media/${MEDIA_ID}`]: {
        context: {
          project: { id: 2, name: 'Alpha' },
          media: { id: MEDIA_ID, kind, originalName: 'shot010_comp_v003.mov' },
        },
      },
      ...extra,
    },
  });

describe('ReviewPage — viewer monté selon le type de média', () => {
  it('monte le lecteur vidéo et son panneau de lecture pour une vidéo', async () => {
    const { container } = mount('VIDEO');

    await waitFor(() => expect(container.querySelector('video')).not.toBeNull());
    expect(screen.getByRole('button', { name: t('panel.playback') })).toBeInTheDocument();
    // Outils propres à la 2D image et à la 3D : absents.
    expect(screen.queryByRole('button', { name: t('tool.zoom') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.lighting') })).not.toBeInTheDocument();
  });

  it('monte le viewer image et ses outils de zoom pour une image', async () => {
    const { container } = mount('IMAGE');

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(screen.getByRole('button', { name: t('tool.zoom') })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('button', { name: t('panel.playback') })).not.toBeInTheDocument();
  });

  it('monte le viewer 3D, son éclairage et sa scène pour un modèle', async () => {
    const { container } = mount('MODEL_3D');

    expect(await screen.findByRole('button', { name: t('panel.lighting') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('panel.scene') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('tool.poi') })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('button', { name: t('panel.playback') })).not.toBeInTheDocument();
  });

  it('monte le viewer splat, qui a une mise au point mais pas d’éclairage', async () => {
    const { container } = mount('SPLAT');

    expect(await screen.findByRole('button', { name: t('tool.focus') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('panel.scene') })).toBeInTheDocument();
    // Un nuage de splats porte sa propre couleur : pas de panneau d'éclairage.
    expect(screen.queryByRole('button', { name: t('panel.lighting') })).not.toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
  });
});

describe('ReviewPage — panneau de commentaires', () => {
  it('affiche le fil du média et se replie à la demande', async () => {
    const { user } = mount('VIDEO', { 'GET /api/comments': { items: [comment()] } });

    expect(await screen.findByText(comment().content)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('header.hideComments') }));

    await waitFor(() => expect(screen.queryByText(comment().content)).not.toBeInTheDocument());
  });

  it('demande le fil du média affiché, et de lui seul', async () => {
    const { api } = mount('VIDEO', { 'GET /api/comments': { items: [] } });

    expect(await screen.findByText(t('comments.empty'))).toBeInTheDocument();
    const [call] = api.called('GET /api/comments');
    expect(call.url.searchParams.get('mediaObjectId')).toBe(String(MEDIA_ID));
  });

  it('dit pourquoi l’écran est vide quand le média est introuvable', async () => {
    renderWithProviders(<ReviewPage />, {
      route: `/review/${MEDIA_ID}`,
      path: '/review/:mediaId',
      api: {
        [`GET /api/media/${MEDIA_ID}`]: httpError(404, 'Media not found'),
        'GET /api/comments': { items: [] },
      },
    });

    // Le message du serveur remplace le squelette — et aucun viewer n'est monté à vide.
    expect(await screen.findByText('Media not found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.playback') })).toBeNull();
  });
});
