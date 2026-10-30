// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { sanitizeHtml, isValidDiscordWebhook, isValidSlackWebhook } from './sanitize';

describe('sanitizeHtml', () => {
  it('returns an empty string for null, undefined or empty input', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });
  it('neutralises <script> tags', () => {
    expect(sanitizeHtml('<script>alert(1)</script>hi')).not.toContain('<script>');
  });
  it('removes inline event handlers (on*)', () => {
    expect(sanitizeHtml('<a href="x" onclick="evil()">l</a>')).not.toContain('onclick');
  });
  it('keeps safe tags', () => {
    expect(sanitizeHtml('<b>gras</b>')).toBe('<b>gras</b>');
  });
});

describe('isValidDiscordWebhook', () => {
  it('accepts Discord domains over https', () => {
    expect(isValidDiscordWebhook('https://discord.com/api/webhooks/1/abc')).toBe(true);
    expect(isValidDiscordWebhook('https://discordapp.com/api/webhooks/1/abc')).toBe(true);
  });
  it('refuses http (unencrypted)', () => {
    expect(isValidDiscordWebhook('http://discord.com/api/webhooks/1/abc')).toBe(false);
  });
  it('refuses domains outside the allowlist (anti-SSRF)', () => {
    expect(isValidDiscordWebhook('https://evil.com/webhook')).toBe(false);
    expect(isValidDiscordWebhook('https://discord.com.evil.com/webhook')).toBe(false);
  });
  it('refuses empty or non-URL inputs', () => {
    expect(isValidDiscordWebhook(null)).toBe(false);
    expect(isValidDiscordWebhook('pas une url')).toBe(false);
  });
});

describe('isValidSlackWebhook (42.B №67)', () => {
  it('accepts hooks.slack.com over https', () => {
    expect(isValidSlackWebhook('https://hooks.slack.com/services/T00/B00/xyz')).toBe(true);
  });
  it('refuses http, other domains and invalid inputs (anti-SSRF)', () => {
    expect(isValidSlackWebhook('http://hooks.slack.com/services/x')).toBe(false);
    expect(isValidSlackWebhook('https://slack.com/services/x')).toBe(false);
    expect(isValidSlackWebhook('https://hooks.slack.com.evil.com/x')).toBe(false);
    expect(isValidSlackWebhook(null)).toBe(false);
  });
});
