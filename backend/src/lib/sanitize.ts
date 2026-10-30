// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import xss from 'xss';

/**
 * Sanitises an HTML input to prevent XSS (strips scripts, iframes, on* events).
 */
export const sanitizeHtml = (html?: string | null): string => {
  if (!html) return '';
  return xss(html);
};

/**
 * Validates a Discord webhook URL (anti-SSRF): https + domain on a strict allowlist.
 */
export const isValidDiscordWebhook = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ['discord.com', 'discordapp.com'].includes(parsed.hostname);
  } catch {
    return false;
  }
};

/**
 * Validates an incoming Slack webhook URL (anti-SSRF): https + `hooks.slack.com` (42.B — №67).
 */
export const isValidSlackWebhook = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'hooks.slack.com';
  } catch {
    return false;
  }
};
