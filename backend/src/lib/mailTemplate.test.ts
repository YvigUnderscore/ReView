import { describe, it, expect } from 'vitest';
import { mailLayout, MAIL_ACCENT } from './mailTemplate';

describe('mailTemplate — enveloppe de marque (Phase 22)', () => {
  it('emballe le titre et le contenu', () => {
    const html = mailLayout('Mon titre', '<p>Corps</p>');
    expect(html).toContain('Mon titre');
    expect(html).toContain('<p>Corps</p>');
    expect(html).toContain('ReView'); // en-tête de marque
  });

  it('expose un accent de marque non vide', () => {
    expect(MAIL_ACCENT).toMatch(/^#/);
  });
});
