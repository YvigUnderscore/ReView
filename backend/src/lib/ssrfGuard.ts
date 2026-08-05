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

/** Adresse IPv6 hors de l'espace routable public ? (y compris IPv4 mappée) */
function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().split('%')[0]!;
  if (v === '::1' || v === '::') return true;
  // ::ffff:127.0.0.1 — on retombe sur les règles IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique-local
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true; // link-local
  if (v.startsWith('ff')) return true; // multicast
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
    return { ok: false, reason: 'URL invalide' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `schéma non autorisé (${url.protocol.replace(':', '')})` };
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isPrivateAddress(host)
      ? { ok: false, reason: 'adresse interne interdite' }
      : { ok: true, reason: '' };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: 'nom introuvable' };
  }
  if (!addresses.length) return { ok: false, reason: 'nom introuvable' };
  // Une seule réponse interne suffit à refuser : le client pourrait tomber dessus.
  if (addresses.some((a) => isPrivateAddress(a.address)))
    return { ok: false, reason: 'le nom résout vers une adresse interne' };
  return { ok: true, reason: '' };
}
