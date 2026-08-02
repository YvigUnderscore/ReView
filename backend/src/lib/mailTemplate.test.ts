// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { mailLayout, MAIL_ACCENT } from './mailTemplate';

describe('mailTemplate — enveloppe de marque (Phase 22)', () => {
  it('emballe le titre et le contenu', () => {
    const html = mailLayout('en', 'Mon titre', '<p>Corps</p>');
    expect(html).toContain('Mon titre');
    expect(html).toContain('<p>Corps</p>');
    expect(html).toContain('ReView'); // en-tête de marque
  });

  it('traduit le pied et annonce la langue du message', () => {
    expect(mailLayout('en', 'T', '')).toContain('collaborative review platform');
    const fr = mailLayout('fr', 'T', '');
    expect(fr).toContain('plateforme de review collaborative');
    expect(fr).toContain('lang="fr"');
  });

  it('expose un accent de marque non vide', () => {
    expect(MAIL_ACCENT).toMatch(/^#/);
  });
});
