// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { deviceLabel } from './deviceLabel';

describe('deviceLabel', () => {
  it('reconnaît Chrome/Windows', () => {
    expect(
      deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'),
    ).toBe('Chrome · Windows');
  });
  it('Edge prime sur Chrome (l’UA Edge contient chrome/)', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36 Edg/126.0')).toBe(
      'Edge · Windows',
    );
  });
  it('Safari macOS et iOS', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1')).toBe(
      'Safari · macOS',
    );
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/604.1')).toBe(
      'Safari · iOS',
    );
  });
  it('repli sur inconnu', () => {
    expect(deviceLabel(null)).toBe('Unknown device');
    // Ce repli valait « Navigateur » — un littéral français qui s'affichait dans les quatorze
    // langues, sur la liste des sessions actives du profil. L'assertion figeait la faute.
    expect(deviceLabel('curl/8.0')).toBe('Browser');
  });

  it('aucun libellé n’échappe à la traduction', () => {
    // Le détecteur `check-untranslated` ne lit que le JSX : un littéral posé dans un module
    // `lib/` lui est invisible. Cette assertion tient la place du contrôle manquant.
    expect(deviceLabel('curl/8.0')).not.toMatch(/Navigateur/);
  });
});
