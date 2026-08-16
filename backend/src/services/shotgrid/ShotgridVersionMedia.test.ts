// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
import { shouldImportMedia } from './shotgridLinks';

const base = { withMedia: true, autoImport: true };

describe('shouldImportMedia', () => {
  it('rapatrie le média d’une version venue du site', () => {
    expect(shouldImportMedia({ ...base, link: {} })).toBe(true);
  });

  it('ne rapatrie pas deux fois le même média', () => {
    expect(shouldImportMedia({ ...base, link: { mediaImported: true } })).toBe(false);
  });

  it('ne rapatrie jamais le média d’une version publiée depuis ReView', () => {
    // Le cas rapporté : publier ici, pousser vers ShotGrid, synchroniser — et se
    // retrouver avec une seconde copie dans la même version.
    expect(shouldImportMedia({ ...base, link: { createdFromReview: true } })).toBe(false);
  });

  it('respecte le réglage d’import automatique', () => {
    expect(shouldImportMedia({ ...base, autoImport: false, link: {} })).toBe(false);
  });

  it('ne fait rien quand la passe ne porte pas sur les médias', () => {
    expect(shouldImportMedia({ ...base, withMedia: false, link: {} })).toBe(false);
  });
});
