// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { isPrivateAddress, expandIPv6 } from './ssrfGuard';

/**
 * One and the same IPv6 address can be written in several ways. A prefix check on the
 * string only sees one of them: `::1` was refused but `0:0:0:0:0:0:0:1` passed as public.
 */
describe('expandIPv6', () => {
  it('expands compressed and long forms to the same value', () => {
    expect(expandIPv6('::1')).toEqual(expandIPv6('0:0:0:0:0:0:0:1'));
    expect(expandIPv6('::1')).toEqual(expandIPv6('0000:0000:0000:0000:0000:0000:0000:0001'));
    expect(expandIPv6('::ffff:127.0.0.1')).toEqual(expandIPv6('0:0:0:0:0:ffff:127.0.0.1'));
  });

  it('ignores the zone identifier', () => {
    expect(expandIPv6('fe80::1%eth0')).toEqual(expandIPv6('fe80::1'));
  });

  it('rejects unusable syntax', () => {
    for (const bad of ['::1::2', 'gggg::1', '1:2:3:4:5:6:7:8:9', '1.2.3.4::1', ''])
      expect(expandIPv6(bad), bad).toBeNull();
  });
});

describe('isPrivateAddress — equivalence between notations', () => {
  it('rejects the loopback address in any form', () => {
    for (const ip of ['::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001'])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('rejects a mapped IPv4 address in all its notations', () => {
    for (const ip of [
      '::ffff:127.0.0.1',
      '0:0:0:0:0:ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '::ffff:10.0.0.1',
      '::127.0.0.1', // IPv4-compatible form
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('rejects unique-local, link-local and multicast addresses in uppercase as well as lowercase', () => {
    for (const ip of ['FD00::1', 'fd00::1', 'FE80::1', 'fe80::1', 'FF02::1', 'fc00::1'])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('rejects the NAT64 prefix translating an internal address', () => {
    expect(isPrivateAddress('64:ff9b::7f00:1')).toBe(true); // 127.0.0.1
  });

  it('lets through IPv6 addresses that are really public', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
