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

/**
 * Le seul paramètre de `mailLayout` qui soit du HTML s'appelle `contentHtml`. Le titre,
 * lui, est une donnée : `ShareMailService` y met le nom d'un projet, qu'un superviseur
 * renomme à sa guise. Un lien dans le titre en gras d'un message envoyé par le relais
 * SMTP du studio est un hameçonnage prêt à l'emploi.
 */
describe('mailTemplate — le titre est une donnée, pas du balisage', () => {
  it('échappe le titre', () => {
    const html = mailLayout('en', 'Réf. <a href="https://faux.example">Ouvrir</a>', '<p>x</p>');
    expect(html).not.toContain('<a href="https://faux.example">');
    expect(html).toContain('&lt;a href=&quot;https://faux.example&quot;&gt;');
    expect(html).toContain('<p>x</p>'); // le corps, lui, reste du HTML
  });

  it('échappe le libellé et l’adresse du bouton', () => {
    const html = mailButton('https://example.com/x"><script>alert(1)</script>', '<b>Go</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Go</b>');
    expect(html).toContain('&lt;b&gt;Go&lt;/b&gt;');
  });

  it('laisse une URL ordinaire intacte dans le bouton', () => {
    expect(mailButton('https://example.com/x', 'Go')).toContain('href="https://example.com/x"');
  });
});
