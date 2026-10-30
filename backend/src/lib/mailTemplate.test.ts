// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { mailLayout, mailButton, MAIL_ACCENT, MAIL_BORDER, MAIL_MUTED } from './mailTemplate';

describe('mailTemplate — brand wrapper (Phase 22)', () => {
  it('wraps the title and the content', () => {
    const html = mailLayout('en', 'Mon titre', '<p>Corps</p>');
    expect(html).toContain('Mon titre');
    expect(html).toContain('<p>Corps</p>');
    expect(html).toContain('ReView'); // brand header
  });

  it('translates the footer and announces the message language', () => {
    expect(mailLayout('en', 'T', '')).toContain('collaborative review platform');
    const fr = mailLayout('fr', 'T', '');
    expect(fr).toContain('plateforme de review collaborative');
    expect(fr).toContain('lang="fr"');
  });

  it("exposes the colours of the app's dark theme, not approximations", () => {
    // Mirror of `frontend/src/index.css` (.dark): a mail that does not carry the interface colours
    // looks like a mail from another product.
    expect(MAIL_ACCENT).toBe('#00F0FF');
    expect(MAIL_BORDER).toBe('#1E2433');
    expect(MAIL_MUTED).toBe('#9BA3B2');
    expect(mailLayout('en', 'T', '')).toContain('#0B0E14');
  });

  it('no longer shows a gradient banner', () => {
    expect(mailLayout('en', 'T', '')).not.toContain('linear-gradient');
  });

  it('renders a clickable button with inline styles (no stylesheet in mail)', () => {
    const html = mailButton('https://example.com/x', 'Go');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('Go');
    expect(html).toContain(MAIL_ACCENT);
    expect(html).not.toContain('<button');
  });
});

/**
 * The only parameter of `mailLayout` that is HTML is called `contentHtml`. The title, however, is data:
 * `ShareMailService` puts a project name in it, which a supervisor renames at will. A link in the bold title of a
 * message sent through the studio's SMTP relay is ready-made phishing.
 */
describe('mailTemplate — the title is data, not markup', () => {
  it('escapes the title', () => {
    const html = mailLayout('en', 'Réf. <a href="https://faux.example">Ouvrir</a>', '<p>x</p>');
    expect(html).not.toContain('<a href="https://faux.example">');
    expect(html).toContain('&lt;a href=&quot;https://faux.example&quot;&gt;');
    expect(html).toContain('<p>x</p>'); // the body, however, stays HTML
  });

  it('escapes the label and the address of the button', () => {
    const html = mailButton('https://example.com/x"><script>alert(1)</script>', '<b>Go</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Go</b>');
    expect(html).toContain('&lt;b&gt;Go&lt;/b&gt;');
  });

  it('leaves an ordinary URL intact in the button', () => {
    expect(mailButton('https://example.com/x', 'Go')).toContain('href="https://example.com/x"');
  });
});
