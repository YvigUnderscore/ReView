// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { mailLayout, mailButton, MAIL_ACCENT, MAIL_BORDER, MAIL_MUTED } from './mailTemplate';

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

  it('expose les couleurs du thème sombre de l’app, pas des approximations', () => {
    // Miroir de `frontend/src/index.css` (.dark) : un mail qui ne porte pas les couleurs de
    // l'interface ressemble à un mail d'un autre produit.
    expect(MAIL_ACCENT).toBe('#00F0FF');
    expect(MAIL_BORDER).toBe('#1E2433');
    expect(MAIL_MUTED).toBe('#9BA3B2');
    expect(mailLayout('en', 'T', '')).toContain('#0B0E14');
  });

  it('n’affiche plus de bandeau en dégradé', () => {
    expect(mailLayout('en', 'T', '')).not.toContain('linear-gradient');
  });

  it('rend un bouton cliquable en styles inline (aucune feuille de style en mail)', () => {
    const html = mailButton('https://example.com/x', 'Go');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('Go');
    expect(html).toContain(MAIL_ACCENT);
    expect(html).not.toContain('<button');
  });
});
