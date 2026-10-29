// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { AnnouncementFrequency } from '@prisma/client';
import { shouldShow } from './AnnouncementService';

const now = new Date('2026-07-14T10:00:00Z');

describe('AnnouncementService.shouldShow: frequency (Phase 22)', () => {
  it('PERMANENT: always shown (even when read)', () => {
    expect(shouldShow(AnnouncementFrequency.PERMANENT, null, now)).toBe(true);
    expect(shouldShow(AnnouncementFrequency.PERMANENT, new Date('2026-07-14T09:00:00Z'), now)).toBe(true);
  });

  it('FIRST_LOGIN: shown while unread, then never', () => {
    expect(shouldShow(AnnouncementFrequency.FIRST_LOGIN, null, now)).toBe(true);
    expect(shouldShow(AnnouncementFrequency.FIRST_LOGIN, new Date('2020-01-01T00:00:00Z'), now)).toBe(false);
  });

  it('FIRST_OF_DAY: shown again if the last acknowledgement is from another day', () => {
    expect(shouldShow(AnnouncementFrequency.FIRST_OF_DAY, null, now)).toBe(true);
    // read today -> hidden
    expect(shouldShow(AnnouncementFrequency.FIRST_OF_DAY, new Date('2026-07-14T08:00:00Z'), now)).toBe(false);
    // read yesterday -> shown again
    expect(shouldShow(AnnouncementFrequency.FIRST_OF_DAY, new Date('2026-07-13T23:59:00Z'), now)).toBe(true);
  });
});
