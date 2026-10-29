// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
import { shouldImportMedia } from './shotgridLinks';

const base = { withMedia: true, autoImport: true };

describe('shouldImportMedia', () => {
  it('fetches the media of a version coming from the site', () => {
    expect(shouldImportMedia({ ...base, link: {} })).toBe(true);
  });

  it('does not fetch the same media twice', () => {
    expect(shouldImportMedia({ ...base, link: { mediaImported: true } })).toBe(false);
  });

  it('never fetches the media of a version published from ReView', () => {
    // The reported case: publish here, push to ShotGrid, synchronize — and end up with a second copy in the same version.
    expect(shouldImportMedia({ ...base, link: { createdFromReview: true } })).toBe(false);
  });

  it('respects the automatic import setting', () => {
    expect(shouldImportMedia({ ...base, autoImport: false, link: {} })).toBe(false);
  });

  it('does nothing when the pass does not concern the media', () => {
    expect(shouldImportMedia({ ...base, withMedia: false, link: {} })).toBe(false);
  });
});
