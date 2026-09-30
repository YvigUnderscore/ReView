// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Garde anti-SSRF pour les requêtes sortantes déclenchées par une URL configurable
 * (webhooks 36.D). Les workers tournent à l'intérieur du réseau applicatif : MinIO, Redis
 * et Postgres y répondent sans authentification réseau, et un hébergeur cloud y expose son
 * service de métadonnées sur 169.254.169.254. Pouvoir administrer ReView ne doit pas
 * valoir capacité d'émettre des requêtes arbitraires depuis ce réseau.
 *
 * Le contrôle porte sur l'ADRESSE RÉSOLUE, pas sur le nom : un domaine public peut très
 * bien pointer vers 127.0.0.1. Il reste une fenêtre de DNS rebinding entre cette
 * résolution et celle du `fetch` ; la refermer imposerait de piloter le socket nous-mêmes.
 * Combinée au refus de suivre les redirections, cette vérification écarte l'essentiel des
 * chemins réellement praticables.
 */

export interface TargetVerdict {
  ok: boolean;
  reason: string;
}

/** Adresse IPv4 hors de l'espace routable public ? */
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 — « cet hôte »
  if (a === 10) return true; // privé
  if (a === 127) return true; // boucle locale
  if (a === 169 && b === 254) return true; // link-local + métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return true; // privé
  if (a === 192 && b === 168) return true; // privé
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast + réservé + broadcast
  return false;
}

/**
 * Développe une IPv6 en ses 16 octets, ou `null` si la syntaxe est inexploitable.
 *
 * Indispensable : une même adresse s'écrit de plusieurs façons, et un contrôle par préfixe
 * de chaîne n'en voit qu'une. `::1`, `0:0:0:0:0:0:0:1` et `0000:…:0001` sont la même boucle
 * locale ; `::ffff:127.0.0.1` s'écrit aussi `0:0:0:0:0:ffff:127.0.0.1`. On normalise donc
 * avant de décider, plutôt que de comparer des débuts de chaîne.
 */
export function expandIPv6(ip: string): Uint8Array | null {
  const v = ip.toLowerCase().split('%')[0]!; // retire l'identifiant de zone (fe80::1%eth0)
  const halves = v.split('::');
  if (halves.length > 2) return null;

  // Une IPv6 peut se terminer par une notation pointée (formes mappées/compatibles IPv4).
  // `isTail` dit si ce fragment termine l'adresse : la partie pointée n'est légale que là.
  const parseGroups = (part: string, isTail: boolean): number[] | null => {
    if (!part) return [];
    const groups: number[] = [];
    const items = part.split(':');
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.includes('.')) {
        if (!isTail || i !== items.length - 1) return null; // doit clore l'adresse entière
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

/** Adresse IPv6 hors de l'espace routable public ? (formes mappées IPv4 comprises) */
function isPrivateIPv6(ip: string): boolean {
  const b = expandIPv6(ip);
  if (!b) return true; // syntaxe non comprise : on refuse

  const isZero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const dotted = (from: number) => `${b[from]}.${b[from + 1]}.${b[from + 2]}.${b[from + 3]}`;

  // ::  et  ::1  (quelle que soit l'écriture)
  if (isZero(0, 15) && (b[15] === 0 || b[15] === 1)) return true;
  // ::ffff:a.b.c.d — IPv4 mappée : les règles IPv4 s'appliquent.
  if (isZero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(dotted(12));
  // ::a.b.c.d — IPv4 compatible (obsolète mais toujours résolue).
  if (isZero(0, 12)) return isPrivateIPv4(dotted(12));
  // 64:ff9b::/96 — NAT64 : traduit une IPv4, on applique ses règles.
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
  return true; // ni IPv4 ni IPv6 : on refuse par défaut
}

/**
 * L'URL désigne-t-elle une cible HTTP(S) publique ? Résout le nom et refuse toute réponse
 * pointant vers un espace d'adressage interne.
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
  // Une seule réponse interne suffit à refuser : le client pourrait tomber dessus.
  if (addresses.some((a) => isPrivateAddress(a.address)))
    return { ok: false, reason: 'host resolves to an internal address' };
  return { ok: true, reason: '' };
}
