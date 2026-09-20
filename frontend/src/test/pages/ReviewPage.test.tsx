// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
  // Ratio du cadre de review servi par le serveur (réglages pipeline hérités) — 16:9 ici.
  deliveryAspect: 16 / 9,
  trim: null,
  trimProxyReady: false,
  hls: null,
  timelineSprite: null,
  timelineSpriteUrl: null,
  references: [],
  reviewers: [],
  reviewRequest: { requireNote: false, minNoteLength: 5 },
  // Droits rendus par le serveur : le viewer 3D n'offre le mode « Nettoyer » que si
  // l'écriture de la transformation est accordée (cf. `lib/versionPermissions`).
  permissions: { editTransform: true },
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

const mount = (kind: MediaKind, extra: Record<string, MockResolver> = {}, patch: Partial<MediaResp> = {}) =>
  renderWithProviders(<ReviewPage />, {
    route: `/review/${MEDIA_ID}`,
    path: '/review/:mediaId',
    api: {
      [`GET /api/media/${MEDIA_ID}`]: mediaResp(kind, patch),
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
  /**
   * Ces trois tests se reconnaissaient au panneau « Lecture » du dock vidéo. Il a disparu en
   * Phase 50, avec les quatre autres onglets des médias plats : le dock plat est désormais
   * Infos + Export, et c'est lui qu'on affirme. Le viewer, lui, se reconnaît toujours à ce
   * qu'il monte et aux outils qu'il offre.
   */
  it('monte le lecteur vidéo et le dock plat pour une vidéo', async () => {
    const { container } = mount('VIDEO');

    await waitFor(() => expect(container.querySelector('video')).not.toBeNull());
    expect(screen.getByRole('button', { name: t('panel.info') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('panel.export') })).toBeInTheDocument();
    // Outils et panneaux propres au spatial : absents. L'outil « Zoom » ne figure plus dans
    // cette liste — il a été SUPPRIMÉ en Phase 50, faute d'implémentation : le zoom des deux
    // viewers plats est un geste permanent (molette, glissement, `+`/`-`, `F`, `H`).
    expect(screen.queryByRole('button', { name: t('tool.poi') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.lighting') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.camera') })).not.toBeInTheDocument();
  });

  it('monte le viewer image et le rail plat pour une image', async () => {
    const { container } = mount('IMAGE');

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    // Le rail plat est au repos : l'outil de navigation, et rien d'autre. Ce test attendait
    // l'outil « Zoom », supprimé en Phase 50 — il était visible ici et n'armait rien.
    expect(screen.getByRole('button', { name: t('tool.nav') })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    // Même dock que la vidéo, aux mêmes deux onglets.
    expect(screen.getByRole('button', { name: t('panel.info') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.camera') })).not.toBeInTheDocument();
  });

  it('monte le viewer 3D, son éclairage et sa scène pour un modèle', async () => {
    const { container } = mount('MODEL_3D');

    expect(await screen.findByRole('button', { name: t('panel.lighting') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('panel.scene') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('tool.poi') })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
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

/**
 * Bascule de mode et réglages de rendu du viewer 3D (Phase 50, lot 6).
 *
 * Trois retraits à constater sur l'écran réel, parce que chacun visait un geste qui ne menait
 * nulle part : le segment « Mise en scène » (deux commandes pour un seul état), le segment
 * « Nettoyer » sans le droit d'enregistrer (bouton refusé en 403), et l'onglet « Affichage »
 * (réglages à traverser l'écran). Et trois présences : l'interrupteur de mise en scène dans le
 * panneau Caméra, le mode « Nettoyer » quand le serveur l'accorde, et les réglages de rendu au
 * coin haut-gauche du viewer.
 */
describe('ReviewPage — chrome du viewer 3D', () => {
  it('n’offre ni segment « Mise en scène » ni onglet « Affichage »', async () => {
    mount('MODEL_3D');

    expect(await screen.findByRole('button', { name: t('mode.explore') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('mode.stage') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.display') })).not.toBeInTheDocument();
  });

  it('offre « Nettoyer » quand le serveur accorde l’écriture de la transformation', async () => {
    mount('MODEL_3D', {}, { permissions: { editTransform: true } });

    expect(await screen.findByRole('button', { name: t('mode.clean') })).toBeInTheDocument();
  });

  it('retire « Nettoyer » quand le serveur la refuse — plus de bouton mort', async () => {
    // C'est le cas d'un ARTIST membre du projet qui n'est pas l'auteur de la version : le
    // mode ne lui proposait qu'un « Enregistrer » que `VersionService.update` refuse en 403.
    mount('MODEL_3D', {}, { permissions: { editTransform: false } });

    expect(await screen.findByRole('button', { name: t('tool.poi') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('mode.clean') })).not.toBeInTheDocument();
  });

  it('pose les réglages de rendu dans le viewer, et le mode de rendu dedans', async () => {
    const { user } = mount('MODEL_3D');

    await user.click(await screen.findByRole('button', { name: t('viewer.render.title') }));
    expect(screen.getByRole('group', { name: t('viewer.render.model') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('viewer.mode.wireframe') })).toBeInTheDocument();
  });

  it('garde la mise en scène joignable : son interrupteur est au panneau Caméra', async () => {
    const { container, user } = mount('MODEL_3D');

    // Requête bornée au dock : la piste du transport porte aussi le libellé « Camera ».
    await screen.findByRole('button', { name: t('panel.info') });
    const dock = within(container.querySelector('.rv-dock') as HTMLElement);
    await user.click(dock.getByRole('button', { name: t('panel.camera') }));
    // Nommé par le mode qu'il arme, et non par la fenêtre PiP qu'il ouvre.
    expect(dock.getByText(t('mode.stage'))).toBeInTheDocument();
    expect(dock.getByRole('switch')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: t('panel.info') })).toBeNull();
  });
});
