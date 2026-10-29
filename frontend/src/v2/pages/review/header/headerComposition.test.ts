// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MediaKind } from '../../../types/api';
import {
  chromeHostsHeader,
  headerActions,
  imageCompareOverlay,
  type HeaderActionContext,
} from './headerComposition';

/** Published media, without ShotGrid, without viewers, without a detachable player. */
const base = (over: Partial<HeaderActionContext> = {}): HeaderActionContext => ({
  kind: 'VIDEO',
  published: true,
  hasSgLink: false,
  hasViewers: false,
  canPictureInPicture: false,
  ...over,
});

const KINDS: MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];

describe('headerActions', () => {
  it('keeps the actions common to the four media types', () => {
    // The merge was not to lose anything: live, decision, theatre, shortcuts and comment
    // collapsing were on every review before, and they still are.
    for (const kind of KINDS)
      expect(headerActions(base({ kind }))).toEqual(
        expect.arrayContaining(['live', 'decision', 'theater', 'shortcuts', 'comments']),
      );
  });

  it('keeps the header A/B selector only for video', () => {
    // It alone ticks two or three versions at once (2×2 grid). The image chooses A and B in the
    // options bar of the "Compare" mode: a single visible place, instead of a header menu and a
    // dock tab that contradicted each other about where to choose B.
    expect(headerActions(base({ kind: 'VIDEO' }))).toContain('compare');
    expect(headerActions(base({ kind: 'IMAGE' }))).not.toContain('compare');
    expect(headerActions(base({ kind: 'MODEL_3D' }))).not.toContain('compare');
    expect(headerActions(base({ kind: 'SPLAT' }))).not.toContain('compare');
  });

  it('reserves the detachable player for video, and only if the page exposes it', () => {
    expect(headerActions(base({ kind: 'VIDEO', canPictureInPicture: true }))).toContain('pip');
    expect(headerActions(base({ kind: 'VIDEO', canPictureInPicture: false }))).not.toContain('pip');
    expect(headerActions(base({ kind: 'IMAGE', canPictureInPicture: true }))).not.toContain('pip');
    expect(headerActions(base({ kind: 'SPLAT', canPictureInPicture: true }))).not.toContain('pip');
  });

  it('offers publication only on a draft (the publication lock is final)', () => {
    expect(headerActions(base({ published: false }))).toContain('publish');
    expect(headerActions(base({ published: true }))).not.toContain('publish');
  });

  it('hides ShotGrid and presence when there is nothing to show', () => {
    const bare = headerActions(base());
    expect(bare).not.toContain('shotgrid');
    expect(bare).not.toContain('presence');
    const full = headerActions(base({ hasSgLink: true, hasViewers: true }));
    expect(full).toContain('shotgrid');
    expect(full).toContain('presence');
  });

  it('orders A/B first, to join that of the spatial viewers', () => {
    // 3D and splat place their selector in `headerRight` of the chrome, just before this list.
    expect(headerActions(base({ kind: 'VIDEO' }))[0]).toBe('compare');
  });

  it('never repeats an action', () => {
    const all = headerActions(
      base({ published: false, hasSgLink: true, hasViewers: true, canPictureInPicture: true }),
    );
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('imageCompareOverlay', () => {
  it('replaces the viewer only on wipe or difference, and with a B media', () => {
    expect(imageCompareOverlay(42, 'wipe')).toBe('wipe');
    expect(imageCompareOverlay(42, 'diff')).toBe('diff');
    expect(imageCompareOverlay(42, 'side')).toBeNull();
    expect(imageCompareOverlay(null, 'wipe')).toBeNull();
  });
});

describe('chromeHostsHeader', () => {
  const host = (over: Partial<Parameters<typeof chromeHostsHeader>[0]> = {}) =>
    chromeHostsHeader({ hasData: true, kind: 'VIDEO', ...over });

  it('entrusts the header to the chrome for the four media types', () => {
    for (const kind of KINDS) expect(host({ kind })).toBe(true);
  });

  it('takes it back from the page as long as the media is not loaded', () => {
    expect(host({ hasData: false })).toBe(false);
    expect(host({ hasData: true, kind: undefined })).toBe(false);
  });

  it('keeps the chrome during image comparison, now an overlay of the viewport', () => {
    // Wipe and difference used to unmount the whole chrome: the mode toggle and the A/B settings
    // went with them, at the very moment they were needed. This test locked in the old behaviour;
    // it is deliberately rewritten.
    for (const kind of KINDS) expect(host({ kind })).toBe(true);
  });
});
