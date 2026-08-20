// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MessageKey } from '../../../i18n';
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
  it('montre le fichier source quand il diffère du nom affiché', () => {
    // Le média importé porte le code du site ; le nom livré reste consultable.
    const rows = sheetRows(t, data({ sourceFilename: 'playblast_FINAL.mov' }), 'VIDEO', 24);
    expect(rows.find((r) => r.label === 'review.sourceFile')?.value).toBe('playblast_FINAL.mov');
  });

  it('ne le répète pas quand les deux noms coïncident', () => {
    const rows = sheetRows(t, data({ sourceFilename: 'SH010_comp_v003.mov' }), 'VIDEO', 24);
    expect(rows.some((r) => r.label === 'review.sourceFile')).toBe(false);
  });

  it('l’omet pour un média qui ne vient pas de ShotGrid', () => {
    const rows = sheetRows(t, data({ sourceFilename: null }), 'IMAGE', 24);
    expect(rows.some((r) => r.label === 'review.sourceFile')).toBe(false);
  });
});
