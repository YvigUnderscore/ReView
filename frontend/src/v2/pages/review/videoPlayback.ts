// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Media } from '../../types/api';

/** Cadence de relecture du média pendant l'assemblage d'une séquence. */
export const ASSEMBLING_POLL_MS = 5000;

/**
 * Ce que le viewer vidéo peut montrer d'un média : le lire, ou dire pourquoi il ne le peut
 * pas encore.
 *
 * Le lecteur reçoit `proxyUrl ?? url`. Pour une vidéo livrée en fichier, `url` est encore
 * lisible pendant le traitement ; pour une séquence d'images, c'est le manifeste
 * `sequence.json` — le lecteur tentait de lire du JSON et restait muet. Et un traitement en
 * échec ne laissait voir ni sa raison ni le moyen de le relancer, alors que le message du
 * worker y renvoie.
 */
export type VideoPlayback = 'play' | 'assembling' | 'failed';

/** Une séquence porte son motif FFmpeg comme nom (`plan.%04d.exr`), jamais un nom de fichier. */
export const isSequenceName = (name: string): boolean => /%0\d+d\.[A-Za-z0-9]+$/.test(name);

export function videoPlayback(
  media: Pick<Media, 'status' | 'originalName'>,
  proxyUrl: string | null,
): VideoPlayback {
  // Un proxy déjà produit reste lisible, même si une relance ultérieure a échoué.
  if (proxyUrl) return 'play';
  if (media.status === 'FAILED') return 'failed';
  if (media.status !== 'READY' && isSequenceName(media.originalName)) return 'assembling';
  return 'play';
}

/**
 * Seule exception au « jamais de refetch » de la page de review (URLs présignées) : une
 * séquence en cours d'assemblage n'a rien à lire, il n'y a donc aucune lecture à
 * interrompre — et le lecteur s'ouvre de lui-même dès qu'elle est prête.
 */
export function assemblingPollMs(
  data: { media: Pick<Media, 'kind' | 'status' | 'originalName'>; proxyUrl: string | null } | undefined,
): number | false {
  return data?.media.kind === 'VIDEO' && videoPlayback(data.media, data.proxyUrl) === 'assembling'
    ? ASSEMBLING_POLL_MS
    : false;
}
