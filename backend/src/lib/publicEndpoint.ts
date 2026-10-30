// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Is the public storage address a loopback address?
 *
 * `S3_PUBLIC_ENDPOINT` is not used by the server: it is used to build the presigned URLs that the BROWSER will call. A loopback
 * address therefore designates the visitor's machine, not the host — and every media upload goes into the void as soon as ReView
 * is opened from another machine. The failure is silent: the upload request never leaves the machine, no server log is written,
 * and nothing links it to a setting.
 *
 * This check is deliberately syntactic — no DNS resolution. It runs at start-up, it must neither block nor depend on the network;
 * and it does not try to decide whether the address is *reachable*, only whether it structurally cannot be from elsewhere.
 * `ssrfGuard`, for its part, really resolves: these are two different questions.
 */
export function isLoopbackEndpoint(endpoint: string | undefined | null): boolean {
  if (!endpoint) return false;

  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    // An unreadable value is not our concern: the configuration will fail elsewhere, with a message about it. Better to stay silent
    // than to shout beside the point.
    return false;
  }

  // `new URL` keeps the brackets of a literal IPv6; remove them before comparing.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const lower = bare.toLowerCase();

  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  // `0.0.0.0` is not loopback as such, but "all interfaces" is not an address a browser can call either.
  if (lower === '0.0.0.0' || lower === '::') return true;

  // `new URL` NORMALISES IPv6: `0:0:0:0:0:0:0:1` becomes `::1`, and a mapped IPv4 is written in hexadecimal — `::ffff:127.0.0.1`
  // becomes `::ffff:7f00:1`. Looking for the decimal form here would never find anything.
  if (lower === '::1') return true;
  const mappe = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(lower);
  if (mappe) return Number.parseInt(mappe[1] as string, 16) >>> 8 === 0x7f;

  // The whole /8 is loopback, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower);
}
