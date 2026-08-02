import { t } from '../i18n'; // SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Étiquette lisible d'un user-agent (36.B, liste des sessions) — heuristique volontairement simple. */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return t('common.unknownDevice');
  const ua = userAgent.toLowerCase();
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('opr/') || ua.includes('opera')
      ? 'Opera'
      : ua.includes('chrome/')
        ? 'Chrome'
        : ua.includes('firefox/')
          ? 'Firefox'
          : ua.includes('safari/')
            ? 'Safari'
            : 'Navigateur';
  const os = ua.includes('windows')
    ? 'Windows'
    : ua.includes('android')
      ? 'Android'
      : ua.includes('iphone') || ua.includes('ipad')
        ? 'iOS'
        : ua.includes('mac os')
          ? 'macOS'
          : ua.includes('linux')
            ? 'Linux'
            : null;
  return os ? `${browser} · ${os}` : browser;
}
