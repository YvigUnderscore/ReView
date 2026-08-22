// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Particularités d'un master de post-production qui changent la façon de l'encoder.
 *
 * Un livrable de studio ne ressemble pas au MP4 pour lequel la chaîne a été écrite : un
 * MXF de diffusion est fréquemment entrelacé, un master ProRes porte souvent plus de deux
 * canaux audio. Encodés sans précaution, le premier sort peigné et le second en 5.1 — deux
 * défauts qu'on ne découvre qu'à la review, l'encodage déjà payé.
 *
 * Les décisions vivent ici, séparées de leur exécution, pour être vérifiables sans lancer
 * FFmpeg. Elles sont prises **une fois** après la sonde et appliquées à l'identique au
 * proxy et à toute l'échelle HLS : sans quoi une rendition désentrelacée côtoierait une
 * rendition peignée, et le changement de qualité se verrait à l'image.
 */

import { isInterlaced } from './ffprobe';

export interface SourceTraits {
  deinterlace: boolean;
  downmixStereo: boolean;
}

export const NO_TRAITS: SourceTraits = { deinterlace: false, downmixStereo: false };

/**
 * Déduit les traits du master de ce que la sonde a relevé.
 *
 * Prend le bloc de métadonnées tel qu'il est assemblé par le worker (valeurs de type
 * incertain) : une sonde muette — ffprobe qui n'a rien su lire — ne doit rien déclencher.
 */
export function sourceTraits(meta: Record<string, unknown>): SourceTraits {
  const fieldOrder = typeof meta.fieldOrder === 'string' ? meta.fieldOrder : undefined;
  const channels = typeof meta.audioChannels === 'number' ? meta.audioChannels : 0;
  return { deinterlace: isInterlaced(fieldOrder), downmixStereo: channels > 2 };
}

/**
 * Filtres à insérer **en tête** de la chaîne vidéo.
 *
 * `yadif` coûte un champ sur deux, mais l'image cesse de peigner. Il précède le
 * redimensionnement : mis après, il désentrelacerait des champs déjà mélangés par le
 * rééchantillonnage, ce qui ne se rattrape pas.
 */
export const preFiltersFor = (traits: SourceTraits): string[] => (traits.deinterlace ? ['yadif'] : []);

/** Downmix stéréo des masters multicanal (5.1 et au-delà). Jamais d'upmix. */
export const audioOptionsFor = (traits: SourceTraits): string[] => (traits.downmixStereo ? ['-ac', '2'] : []);
