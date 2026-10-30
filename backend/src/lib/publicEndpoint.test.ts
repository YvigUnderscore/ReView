// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isLoopbackEndpoint } from './publicEndpoint';

describe('isLoopbackEndpoint', () => {
  /**
   * The case that cost a session: `docker compose up` without going through `install.sh` leaves
   * `S3_PUBLIC_ENDPOINT` at `http://localhost:9000`, and the upload fails silently as soon as ReView is
   * opened from another machine on the network.
   */
  it('recognises the default of the docker stack', () => {
    expect(isLoopbackEndpoint('http://localhost:9000')).toBe(true);
  });

  it('recognises the whole loopback /8, not just 127.0.0.1', () => {
    expect(isLoopbackEndpoint('http://127.0.0.1:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://127.0.1.1:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://127.255.255.254/')).toBe(true);
  });

  it('recognises IPv6 forms, brackets included', () => {
    expect(isLoopbackEndpoint('http://[::1]:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://[0:0:0:0:0:0:0:1]:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://[::ffff:127.0.0.1]:9000')).toBe(true);
  });

  // "All interfaces" is not loopback, but it is not an address a browser can call either: the same warning applies.
  it('treats "all interfaces" as unusable from the browser side', () => {
    expect(isLoopbackEndpoint('http://0.0.0.0:9000')).toBe(true);
    expect(isLoopbackEndpoint('http://[::]:9000')).toBe(true);
  });

  it('lets through an address the network can reach', () => {
    expect(isLoopbackEndpoint('http://192.168.1.115:9000')).toBe(false);
    expect(isLoopbackEndpoint('https://stockage.studio.example')).toBe(false);
    expect(isLoopbackEndpoint('http://minio:9000')).toBe(false);
    // 127 anywhere other than the first octet is not loopback.
    expect(isLoopbackEndpoint('http://10.127.0.1:9000')).toBe(false);
    expect(isLoopbackEndpoint('http://192.168.127.1:9000')).toBe(false);
  });

  // A host ending in "localhost" is reserved for loopback (RFC 6761).
  it('takes subdomains of localhost into account', () => {
    expect(isLoopbackEndpoint('http://minio.localhost:9000')).toBe(true);
    // …but not a domain that merely contains the word.
    expect(isLoopbackEndpoint('http://localhost.studio.example')).toBe(false);
  });

  it('stays silent on an absent or unreadable value — that is not its concern', () => {
    expect(isLoopbackEndpoint(undefined)).toBe(false);
    expect(isLoopbackEndpoint(null)).toBe(false);
    expect(isLoopbackEndpoint('')).toBe(false);
    expect(isLoopbackEndpoint('pas une url')).toBe(false);
  });
});
