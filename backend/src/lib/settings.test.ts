// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { UPSTREAM_SOURCE_URL, safeSourceUrl } from './settings';

describe('safeSourceUrl', () => {
  it('accepte http et https', () => {
    expect(safeSourceUrl('https://git.studio.tld/review')).toBe('https://git.studio.tld/review');
    expect(safeSourceUrl('http://192.168.1.10:3000/sources')).toBe('http://192.168.1.10:3000/sources');
  });

  it('ignore les espaces autour de la valeur', () => {
    expect(safeSourceUrl('  https://example.org/review  ')).toBe('https://example.org/review');
  });

  it('retombe sur l’amont quand le réglage est vide', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(safeSourceUrl(value)).toBe(UPSTREAM_SOURCE_URL);
    }
  });

  it('refuse les schémas dangereux : la valeur finit dans un href', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
    ]) {
      expect(safeSourceUrl(value)).toBe(UPSTREAM_SOURCE_URL);
    }
  });

  it('refuse une chaîne qui n’est pas une URL', () => {
    expect(safeSourceUrl('nos sources sont sur le NAS')).toBe(UPSTREAM_SOURCE_URL);
  });
});
