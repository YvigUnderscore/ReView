// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guard against SSRF for outbound requests triggered by a configurable URL
 * (webhooks 36.D). Workers run inside the application network: MinIO, Redis and
 * Postgres answer there without network authentication, and a cloud host exposes its
 * metadata service on 169.254.169.254. Being able to administer ReView must not amount
 * to being able to send arbitrary requests from that network.
 *
 * The check targets the RESOLVED ADDRESS, not the name: a public domain can very well
 * point to 127.0.0.1. A DNS rebinding window remains between this resolution and the
 * one done by `fetch`; closing it would require driving the socket ourselves. Combined
 * with refusing to follow redirects, this check rules out most of the paths that are
 * actually practicable.
 */

export interface TargetVerdict {
  ok: boolean;
  reason: string;
}

/** Whether an IPv4 address lies outside the publicly routable space. */
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 — "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/**
 * Expands an IPv6 address into its 16 octets, or `null` if the syntax is unusable.
 *
 * Essential: one and the same address can be written in several ways, and a string
 * prefix check only sees one of them. `::1`, `0:0:0:0:0:0:0:1` and `0000:…:0001` are the
 * same loopback; `::ffff:127.0.0.1` can also be written `0:0:0:0:0:ffff:127.0.0.1`. So we
 * normalize before deciding, rather than comparing string prefixes.
 */
export function expandIPv6(ip: string): Uint8Array | null {
  const v = ip.toLowerCase().split('%')[0]!; // strip the zone identifier (fe80::1%eth0)
  const halves = v.split('::');
  if (halves.length > 2) return null;

  // An IPv6 address may end with a dotted notation (mapped/compatible IPv4 forms).
  // `isTail` says whether this fragment ends the address: the dotted part is only legal there.
  const parseGroups = (part: string, isTail: boolean): number[] | null => {
    if (!part) return [];
    const groups: number[] = [];
    const items = part.split(':');
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.includes('.')) {
        if (!isTail || i !== items.length - 1) return null; // must close the whole address
        const octets = item.split('.').map(Number);
        if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(item)) return null;
      groups.push(parseInt(item, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0]!, halves.length === 1);
  const tail = halves.length === 2 ? parseGroups(halves[1]!, true) : [];
  if (!head || !tail) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<number>(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    bytes[i * 2] = (g >> 8) & 0xff;
    bytes[i * 2 + 1] = g & 0xff;
  });
  return bytes;
}

/** Whether an IPv6 address lies outside the publicly routable space (IPv4-mapped forms included). */
function isPrivateIPv6(ip: string): boolean {
  const b = expandIPv6(ip);
  if (!b) return true; // unparseable syntax: refuse

  const isZero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const dotted = (from: number) => `${b[from]}.${b[from + 1]}.${b[from + 2]}.${b[from + 3]}`;

  // :: and ::1 (whatever the notation)
  if (isZero(0, 15) && (b[15] === 0 || b[15] === 1)) return true;
  // ::ffff:a.b.c.d — IPv4-mapped: the IPv4 rules apply.
  if (isZero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(dotted(12));
  // ::a.b.c.d — IPv4-compatible (obsolete but still resolved).
  if (isZero(0, 12)) return isPrivateIPv4(dotted(12));
  // 64:ff9b::/96 — NAT64: translates an IPv4 address, so its rules apply.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && isZero(4, 12))
    return isPrivateIPv4(dotted(12));

  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 — unique-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // fe80::/10 — link-local
  if (b[0] === 0xff) return true; // ff00::/8 — multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // neither IPv4 nor IPv6: refuse by default
}

/**
 * Does the URL designate a public HTTP(S) target? Resolves the name and refuses any
 * response pointing into an internal address space.
 */
export async function assertPublicHttpTarget(rawUrl: string): Promise<TargetVerdict> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `scheme not allowed (${url.protocol.replace(':', '')})` };
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isPrivateAddress(host)
      ? { ok: false, reason: 'internal address is not allowed' }
      : { ok: true, reason: '' };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: 'host cannot be resolved' };
  }
  if (!addresses.length) return { ok: false, reason: 'host cannot be resolved' };
  // A single internal response is enough to refuse: the client could end up on it.
  if (addresses.some((a) => isPrivateAddress(a.address)))
    return { ok: false, reason: 'host resolves to an internal address' };
  return { ok: true, reason: '' };
}
