// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MessageKey } from '@/v2/i18n';
import type { MediaResp } from '../reviewTypes';
import { sheetRows } from './mediaSheet';

const t = (key: MessageKey) => key;

const data = (over: Partial<MediaResp>): MediaResp =>
  ({
    media: { originalName: 'SH010_comp_v003.mov', status: 'READY' },
    startFrame: 1001,
    ...over,
  }) as unknown as MediaResp;

describe('sheetRows', () => {
  it('shows the source file when it differs from the displayed name', () => {
    // The imported media carries the site code; the delivered name remains consultable.
    const rows = sheetRows(t, data({ sourceFilename: 'playblast_FINAL.mov' }), 'VIDEO', 24);
    expect(rows.find((r) => r.label === 'review.sourceFile')?.value).toBe('playblast_FINAL.mov');
  });

  it('does not repeat it when the two names coincide', () => {
    const rows = sheetRows(t, data({ sourceFilename: 'SH010_comp_v003.mov' }), 'VIDEO', 24);
    expect(rows.some((r) => r.label === 'review.sourceFile')).toBe(false);
  });

  it('omits it for a media that does not come from ShotGrid', () => {
    const rows = sheetRows(t, data({ sourceFilename: null }), 'IMAGE', 24);
    expect(rows.some((r) => r.label === 'review.sourceFile')).toBe(false);
  });
});
