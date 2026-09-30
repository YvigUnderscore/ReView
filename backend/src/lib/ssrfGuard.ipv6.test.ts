// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { isPrivateAddress, expandIPv6 } from './ssrfGuard';

/**
 * Une même IPv6 s'écrit de plusieurs façons. Un contrôle par préfixe de chaîne n'en voit
 * qu'une : `::1` était refusée mais `0:0:0:0:0:0:0:1` passait pour publique.
 */
describe('expandIPv6', () => {
  it('développe les formes compressées et longues à la même valeur', () => {
    expect(expandIPv6('::1')).toEqual(expandIPv6('0:0:0:0:0:0:0:1'));
    expect(expandIPv6('::1')).toEqual(expandIPv6('0000:0000:0000:0000:0000:0000:0000:0001'));
    expect(expandIPv6('::ffff:127.0.0.1')).toEqual(expandIPv6('0:0:0:0:0:ffff:127.0.0.1'));
  });

  it('ignore l’identifiant de zone', () => {
    expect(expandIPv6('fe80::1%eth0')).toEqual(expandIPv6('fe80::1'));
  });

  it('rejette une syntaxe inexploitable', () => {
    for (const bad of ['::1::2', 'gggg::1', '1:2:3:4:5:6:7:8:9', '1.2.3.4::1', ''])
      expect(expandIPv6(bad), bad).toBeNull();
  });
});

describe('isPrivateAddress — équivalence entre écritures', () => {
  it('refuse la boucle locale quelle que soit sa forme', () => {
    for (const ip of ['::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001'])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('refuse une IPv4 mappée sous toutes ses écritures', () => {
    for (const ip of [
      '::ffff:127.0.0.1',
      '0:0:0:0:0:ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '::ffff:10.0.0.1',
      '::127.0.0.1', // forme IPv4-compatible
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('refuse unique-local, link-local et multicast en majuscules comme en minuscules', () => {
    for (const ip of ['FD00::1', 'fd00::1', 'FE80::1', 'fe80::1', 'FF02::1', 'fc00::1'])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('refuse le préfixe NAT64 traduisant une adresse interne', () => {
    expect(isPrivateAddress('64:ff9b::7f00:1')).toBe(true); // 127.0.0.1
  });

  it('laisse passer les IPv6 réellement publiques', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
