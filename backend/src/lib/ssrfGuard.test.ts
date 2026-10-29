// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { isPrivateAddress, assertPublicHttpTarget } from './ssrfGuard';

describe('isPrivateAddress', () => {
  it('recognizes internal IPv4 ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.169.254', // cloud metadata
      '0.0.0.0',
      '100.64.0.1', // CGNAT
      '224.0.0.1', // multicast
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('lets public addresses through', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('recognizes internal IPv6 ranges, including mapped IPv4', () => {
    for (const ip of ['::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1'])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('rejects anything that is not an address', () => {
    expect(isPrivateAddress('pas-une-ip')).toBe(true);
  });
});

describe('assertPublicHttpTarget', () => {
  it('rejects schemes other than http(s)', async () => {
    for (const u of ['file:///etc/passwd', 'gopher://x/', 'redis://cache:6379'])
      expect((await assertPublicHttpTarget(u)).ok).toBe(false);
  });

  it('rejects a literal internal IP without resolving anything', async () => {
    expect((await assertPublicHttpTarget('http://169.254.169.254/latest/meta-data/')).ok).toBe(false);
    expect((await assertPublicHttpTarget('http://[::1]:9000/review/')).ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  // The core of the fix: the check targets the RESOLVED address. A perfectly public name
  // can point to the loopback or to the metadata service.
  it('rejects a public name that resolves to an internal address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const v = await assertPublicHttpTarget('https://interne.exemple.com/hook');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/internal/);
  });

  it('rejects as soon as ONE of the returned addresses is internal', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ] as never);
    expect((await assertPublicHttpTarget('https://mixte.exemple.com/hook')).ok).toBe(false);
  });

  it('accepts a public target', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    expect((await assertPublicHttpTarget('https://hooks.slack.com/services/x')).ok).toBe(true);
  });

  it('rejects an unknown name', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'));
    expect((await assertPublicHttpTarget('https://nexistepas.exemple/hook')).ok).toBe(false);
  });
});
