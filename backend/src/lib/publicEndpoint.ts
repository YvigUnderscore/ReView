// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * L'adresse publique du stockage est-elle une adresse de bouclage ?
 *
 * `S3_PUBLIC_ENDPOINT` ne sert pas au serveur : il sert à fabriquer les URL présignées que
 * le NAVIGATEUR appellera. Une adresse de bouclage y désigne donc le poste du visiteur, pas
 * l'hôte — et tout envoi de média part dans le vide dès qu'on ouvre ReView depuis une autre
 * machine. La panne est muette : la requête d'upload ne quitte jamais le poste, aucun log
 * serveur ne s'écrit, et rien ne la relie à un réglage.
 *
 * Ce contrôle est volontairement syntaxique — pas de résolution DNS. Il tourne au démarrage,
 * il ne doit ni bloquer ni dépendre du réseau ; et il ne cherche pas à décider si l'adresse
 * est *joignable*, seulement si elle ne peut structurellement pas l'être depuis ailleurs.
 * `ssrfGuard`, lui, résout vraiment : ce sont deux questions différentes.
 */
export function isLoopbackEndpoint(endpoint: string | undefined | null): boolean {
  if (!endpoint) return false;

  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    // Une valeur illisible n'est pas notre affaire : la configuration échouera ailleurs,
    // avec un message qui parle d'elle. Mieux vaut se taire que crier à côté.
    return false;
  }

  // `new URL` conserve les crochets d'une IPv6 littérale ; les ôter avant de comparer.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const lower = bare.toLowerCase();

  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  // `0.0.0.0` n'est pas du bouclage à proprement parler, mais « toutes les interfaces »
  // n'est pas davantage une adresse qu'un navigateur puisse appeler.
  if (lower === '0.0.0.0' || lower === '::') return true;

  // `new URL` NORMALISE les IPv6 : `0:0:0:0:0:0:0:1` arrive en `::1`, et une IPv4 mappée
  // s'écrit en hexadécimal — `::ffff:127.0.0.1` devient `::ffff:7f00:1`. Chercher la forme
  // décimale ici ne trouverait jamais rien.
  if (lower === '::1') return true;
  const mappe = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(lower);
  if (mappe) return Number.parseInt(mappe[1] as string, 16) >>> 8 === 0x7f;

  // Tout le /8 est du bouclage, pas seulement 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower);
}
