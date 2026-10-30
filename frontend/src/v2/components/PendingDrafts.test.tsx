// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import PendingDrafts from './PendingDrafts';
import { t } from '../i18n';

/**
 * The pending-drafts badge, now conditional (Phase 50).
 *
 * What is verified: without the `draftMode` setting, the badge asks the server for NOTHING.
 * A media is born published: the list would be empty on every instance, and the round trip
 * would be paid by every page of every account. With the setting, everything returns: the request
 * goes out and the badge counts what it finds.
 */

const DRAFT = {
  id: 12,
  originalName: 'chase_v003.mov',
  kind: 'VIDEO',
  status: 'READY',
  versionName: 'v003',
  location: 'ALPHA / sq010 / sh020',
  createdAt: '2026-09-01T10:00:00.000Z',
  versionId: 5,
  projectId: 3,
  reviewRequest: { requireNote: false, minNoteLength: 5 },
};

/** Branding served by the shell: it is what carries the setting. */
const branding = (draftMode: boolean) => ({
  name: 'Test Studio',
  accent: null,
  logoUrl: null,
  sourceUrl: 'https://example.invalid/source',
  draftMode,
});

describe('PendingDrafts', () => {
  it('does not request the list of drafts when the studio publishes by default', async () => {
    const { api } = renderWithProviders(<PendingDrafts />, {
      api: {
        'GET /api/studio/branding': branding(false),
        'GET /api/media/drafts': { drafts: [DRAFT] },
      },
    });
    // The branding is indeed read: that is the proof the component had its chance.
    await waitFor(() => expect(api.called('GET /api/studio/branding').length).toBeGreaterThan(0));
    expect(api.called('GET /api/media/drafts')).toHaveLength(0);
    expect(screen.queryByText(t('drafts.count', { count: 1 }))).toBeNull();
  });

  it('counts the drafts when the studio keeps the two-step workflow', async () => {
    renderWithProviders(<PendingDrafts />, {
      api: {
        'GET /api/studio/branding': branding(true),
        'GET /api/media/drafts': { drafts: [DRAFT] },
      },
    });
    expect(await screen.findByText(t('drafts.count', { count: 1 }))).toBeTruthy();
  });
});
