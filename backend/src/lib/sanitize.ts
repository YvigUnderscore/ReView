import xss from 'xss';

/**
 * Nettoie une entrée HTML pour prévenir le XSS (strip scripts, iframes, on* events).
 */
export const sanitizeHtml = (html?: string | null): string => {
  if (!html) return '';
  return xss(html);
};

/**
 * Valide une URL de webhook Discord (anti-SSRF) : https + domaine en allowlist stricte.
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
