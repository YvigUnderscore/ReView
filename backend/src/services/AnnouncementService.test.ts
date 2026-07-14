import { describe, it, expect } from 'vitest';
import { AnnouncementFrequency } from '@prisma/client';
import { shouldShow } from './AnnouncementService';

const now = new Date('2026-07-14T10:00:00Z');

describe('AnnouncementService.shouldShow — fréquence (Phase 22)', () => {
  it('PERMANENT : toujours affichée (même lue)', () => {
    expect(shouldShow(AnnouncementFrequency.PERMANENT, null, now)).toBe(true);
    expect(shouldShow(AnnouncementFrequency.PERMANENT, new Date('2026-07-14T09:00:00Z'), now)).toBe(true);
  });

  it('FIRST_LOGIN : affichée tant que non lue, puis jamais', () => {
    expect(shouldShow(AnnouncementFrequency.FIRST_LOGIN, null, now)).toBe(true);
    expect(shouldShow(AnnouncementFrequency.FIRST_LOGIN, new Date('2020-01-01T00:00:00Z'), now)).toBe(false);
  });

  it('FIRST_OF_DAY : réaffichée si le dernier accusé date d’un autre jour', () => {
    expect(shouldShow(AnnouncementFrequency.FIRST_OF_DAY, null, now)).toBe(true);
    // lue aujourd'hui → masquée
    expect(shouldShow(AnnouncementFrequency.FIRST_OF_DAY, new Date('2026-07-14T08:00:00Z'), now)).toBe(false);
    // lue hier → réaffichée
    expect(shouldShow(AnnouncementFrequency.FIRST_OF_DAY, new Date('2026-07-13T23:59:00Z'), now)).toBe(true);
  });
});
