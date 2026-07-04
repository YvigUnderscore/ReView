import { describe, it, expect } from 'vitest';
import { sanitizeHtml, isValidDiscordWebhook } from './sanitize';

describe('sanitizeHtml', () => {
  it('renvoie une chaîne vide pour null/undefined/vide', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });
  it('neutralise les balises <script>', () => {
    expect(sanitizeHtml('<script>alert(1)</script>hi')).not.toContain('<script>');
  });
  it("retire les gestionnaires d'événements inline (on*)", () => {
    expect(sanitizeHtml('<a href="x" onclick="evil()">l</a>')).not.toContain('onclick');
  });
  it('conserve les balises sûres', () => {
    expect(sanitizeHtml('<b>gras</b>')).toBe('<b>gras</b>');
  });
});

describe('isValidDiscordWebhook', () => {
  it('accepte les domaines Discord en https', () => {
    expect(isValidDiscordWebhook('https://discord.com/api/webhooks/1/abc')).toBe(true);
    expect(isValidDiscordWebhook('https://discordapp.com/api/webhooks/1/abc')).toBe(true);
  });
  it('refuse le http (non chiffré)', () => {
    expect(isValidDiscordWebhook('http://discord.com/api/webhooks/1/abc')).toBe(false);
  });
  it('refuse les domaines hors allowlist (anti-SSRF)', () => {
    expect(isValidDiscordWebhook('https://evil.com/webhook')).toBe(false);
    expect(isValidDiscordWebhook('https://discord.com.evil.com/webhook')).toBe(false);
  });
  it('refuse les entrées vides ou non-URL', () => {
    expect(isValidDiscordWebhook(null)).toBe(false);
    expect(isValidDiscordWebhook('pas une url')).toBe(false);
  });
});
