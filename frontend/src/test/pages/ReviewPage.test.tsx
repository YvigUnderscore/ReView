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
 * Spark loads its WebAssembly module on the first mount of the splat viewer, by fetching it
 * via `fetch`: under happy-dom it receives the response of the HTTP double and rejects
 * outside any test. The module is therefore replaced: it is a rendering engine, with nothing to
 * say about *which* viewer the page picks, which is what this file checks. The tests of the
 * splat itself (SPZ, selection, effects) stay next to their code.
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
 * The review mounts four very different viewers behind a single URL. The regression that
 * costs the most is not visual: it is the wrong viewer, or none. We therefore check, for
 * each `kind`, that the page mounts the tooling of that type *and not* that of another,
 * and then that the comment thread lives alongside, whatever the media.
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
  // Frame ratio of the review served by the server (inherited pipeline settings): 16:9 here.
  deliveryAspect: 16 / 9,
  trim: null,
  trimProxyReady: false,
  hls: null,
  timelineSprite: null,
  timelineSpriteUrl: null,
  references: [],
  reviewers: [],
  reviewRequest: { requireNote: false, minNoteLength: 5 },
  // Rights returned by the server: the 3D viewer offers the "Clean" mode only if
  // write access to the transform is granted (cf. `lib/versionPermissions`).
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

describe('ReviewPage — viewer mounted according to media type', () => {
  /**
   * These three tests were recognized by the "Playback" panel of the video dock. It disappeared in
   * Phase 50, along with the four other tabs of flat media: the flat dock is now
   * Info + Export, and that is what we assert. The viewer, for its part, is still recognized by what
   * it mounts and the tools it offers.
   */
  it('mounts the video player and the flat dock for a video', async () => {
    const { container } = mount('VIDEO');

    await waitFor(() => expect(container.querySelector('video')).not.toBeNull());
    expect(screen.getByRole('button', { name: t('panel.info') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('panel.export') })).toBeInTheDocument();
    // Tools and panels specific to spatial media: absent. The "Zoom" tool is no longer in
    // this list: it was REMOVED in Phase 50, for lack of implementation: the zoom of the two
    // flat viewers is a permanent gesture (wheel, drag, `+`/`-`, `F`, `H`).
    expect(screen.queryByRole('button', { name: t('tool.poi') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.lighting') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.camera') })).not.toBeInTheDocument();
  });

  it('mounts the image viewer and the flat rail for an image', async () => {
    const { container } = mount('IMAGE');

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    // The flat rail is at rest: the navigation tool, and nothing else. This test was waiting for
    // the "Zoom" tool, removed in Phase 50: it was visible here and armed nothing.
    expect(screen.getByRole('button', { name: t('tool.nav') })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    // Same dock as the video, with the same two tabs.
    expect(screen.getByRole('button', { name: t('panel.info') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.camera') })).not.toBeInTheDocument();
  });

  it('mounts the 3D viewer, its lighting and its scene for a model', async () => {
    const { container } = mount('MODEL_3D');

    expect(await screen.findByRole('button', { name: t('panel.lighting') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('panel.scene') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('tool.poi') })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
  });

  it('mounts the splat viewer, which has a focus but no lighting', async () => {
    const { container } = mount('SPLAT');

    expect(await screen.findByRole('button', { name: t('tool.focus') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('panel.scene') })).toBeInTheDocument();
    // A splat cloud carries its own color: no lighting panel.
    expect(screen.queryByRole('button', { name: t('panel.lighting') })).not.toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
  });
});

/**
 * Splat viewer chrome (Phase 50, batch 12), on the real screen.
 *
 * Two segments leave the header: "Staging", which duplicated the switch of the Camera panel,
 * and "Clean", whose tools move onto the viewer. Nothing is deleted for
 * all that: staging keeps its switch, and the render settings are in the top-left corner
 * of the viewer, where the 3D model has had its own since batch 6.
 */
describe('ReviewPage — splat viewer chrome', () => {
  it('offers neither the "Staging" segment nor the "Clean" segment', async () => {
    mount('SPLAT');

    expect(await screen.findByRole('button', { name: t('tool.focus') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('mode.stage') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('mode.clean') })).not.toBeInTheDocument();
  });

  it('sets the render settings in the viewer, inspection tint included', async () => {
    const { user } = mount('SPLAT');

    await user.click(await screen.findByRole('button', { name: t('viewer.render.title') }));
    expect(screen.getByText(t('viewer.inspectionTint'))).toBeInTheDocument();
  });

  it('keeps staging reachable: its switch is in the Camera panel', async () => {
    const { container, user } = mount('SPLAT');

    // Query bounded to the dock: the transport track also carries the label "Camera".
    await screen.findByRole('button', { name: t('panel.info') });
    const dock = within(container.querySelector('.rv-dock') as HTMLElement);
    await user.click(dock.getByRole('button', { name: t('panel.camera') }));
    // Named by the mode it arms, not by the PiP window it opens.
    expect(dock.getByText(t('mode.stage'))).toBeInTheDocument();
    expect(dock.getByRole('switch', { name: t('viewer.pip.hint') })).toBeInTheDocument();
  });
});

/**
 * Mode switch and render settings of the 3D viewer (Phase 50, batch 6).
 *
 * Three removals to be observed on the real screen, because each one targeted a gesture that led
 * nowhere: the "Staging" segment (two commands for a single state), the
 * "Clean" segment without the right to save (button refused with a 403), and the "Display" tab
 * (settings to traverse the screen). And three presences: the staging switch in the
 * Camera panel, the "Clean" mode when the server grants it, and the render settings in the
 * top-left corner of the viewer.
 */
describe('ReviewPage — 3D viewer chrome', () => {
  it('does not offer a "Staging" segment', async () => {
    mount('MODEL_3D');

    expect(await screen.findByRole('button', { name: t('mode.explore') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('mode.stage') })).not.toBeInTheDocument();
    // The "Display" tab is no longer asserted by its label: the key was removed from the
    // catalogs when the splat followed the 3D (batch 12), and no dock carries it any more.
    // It is `panelsFor` that attests to it (`chrome/chromeState.test`), the sole authority on tabs.
  });

  it('offers "Clean" when the server grants write access to the transform', async () => {
    mount('MODEL_3D', {}, { permissions: { editTransform: true } });

    expect(await screen.findByRole('button', { name: t('mode.clean') })).toBeInTheDocument();
  });

  it('removes "Clean" when the server refuses it: no dead button', async () => {
    // This is the case of an ARTIST who is a project member but not the author of the version: the
    // mode only offered them a "Save" that `VersionService.update` refuses with a 403.
    mount('MODEL_3D', {}, { permissions: { editTransform: false } });

    expect(await screen.findByRole('button', { name: t('tool.poi') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('mode.clean') })).not.toBeInTheDocument();
  });

  it('sets the render settings in the viewer, and the render mode in it', async () => {
    const { user } = mount('MODEL_3D');

    await user.click(await screen.findByRole('button', { name: t('viewer.render.title') }));
    expect(screen.getByRole('group', { name: t('viewer.render.model') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('viewer.mode.wireframe') })).toBeInTheDocument();
  });

  it('keeps staging reachable: its switch is in the Camera panel', async () => {
    const { container, user } = mount('MODEL_3D');

    // Query bounded to the dock: the transport track also carries the label "Camera".
    await screen.findByRole('button', { name: t('panel.info') });
    const dock = within(container.querySelector('.rv-dock') as HTMLElement);
    await user.click(dock.getByRole('button', { name: t('panel.camera') }));
    // Named by the mode it arms, not by the PiP window it opens.
    expect(dock.getByText(t('mode.stage'))).toBeInTheDocument();
    expect(dock.getByRole('switch')).toBeInTheDocument();
  });
});

describe('ReviewPage — comment panel', () => {
  it('shows the media thread and collapses on demand', async () => {
    const { user } = mount('VIDEO', { 'GET /api/comments': { items: [comment()] } });

    expect(await screen.findByText(comment().content)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('header.hideComments') }));

    await waitFor(() => expect(screen.queryByText(comment().content)).not.toBeInTheDocument());
  });

  it('requests the thread of the displayed media, and of it alone', async () => {
    const { api } = mount('VIDEO', { 'GET /api/comments': { items: [] } });

    expect(await screen.findByText(t('comments.empty'))).toBeInTheDocument();
    const [call] = api.called('GET /api/comments');
    expect(call.url.searchParams.get('mediaObjectId')).toBe(String(MEDIA_ID));
  });

  it('says why the screen is empty when the media cannot be found', async () => {
    renderWithProviders(<ReviewPage />, {
      route: `/review/${MEDIA_ID}`,
      path: '/review/:mediaId',
      api: {
        [`GET /api/media/${MEDIA_ID}`]: httpError(404, 'Media not found'),
        'GET /api/comments': { items: [] },
      },
    });

    // The server message replaces the skeleton, and no viewer is mounted empty.
    expect(await screen.findByText('Media not found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('panel.info') })).toBeNull();
  });
});

/**
 * Exiting the playback of an annotated comment (Phase 50, batch 13).
 *
 * The pill was placed in the review section, whose first child is the unified header of the
 * chrome: it fell on the mode switch (also centred) or on the instruction strip.
 * It now lives in the media zone, on the same edge for the image, the 3D model and the
 * point cloud. We therefore assert it *inside* `[data-viewer-zone]`, not merely on
 * the screen: it was the position that was at issue.
 */
describe('ReviewPage — leaving the playback of an annotated comment', () => {
  /** Comment carrying an annotation: this is what makes the card selectable. */
  const annotated = comment({
    annotation: [{ id: 'a1', type: 'arrow', color: '#ffffff', width: 3, x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.6 }],
  });

  const openAnnotation = async (kind: MediaKind) => {
    const { container, user } = mount(kind, { 'GET /api/comments': { items: [annotated] } });
    const card = (await screen.findByText(annotated.content)).closest('[role="button"]');
    await user.click(card as HTMLElement);
    return { container, user };
  };

  const exitButton = (container: HTMLElement) =>
    within(container.querySelector('[data-viewer-zone]') as HTMLElement).getByRole('button', {
      name: t('ctx.hideAnnotation'),
    });

  it('places the button in the image viewer', async () => {
    const { container } = await openAnnotation('IMAGE');
    expect(exitButton(container)).toBeInTheDocument();
  });

  it('places the same button in the 3D viewer', async () => {
    const { container } = await openAnnotation('MODEL_3D');
    expect(exitButton(container)).toBeInTheDocument();
  });

  it('places the same button in the splat viewer', async () => {
    const { container } = await openAnnotation('SPLAT');
    expect(exitButton(container)).toBeInTheDocument();
  });

  it('hands control back to the writing: the button disappears with the playback', async () => {
    const { container, user } = await openAnnotation('IMAGE');
    await user.click(exitButton(container));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t('ctx.hideAnnotation') })).not.toBeInTheDocument(),
    );
    // The composer stays at hand: the annotation read, we write the next one.
    expect(screen.getByPlaceholderText(t('comments.placeholder'))).toBeInTheDocument();
  });
});
