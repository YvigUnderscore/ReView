// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { audioOptionsFor, NO_TRAITS, preFiltersFor, sourceTraits } from './masterTraits';

describe('sourceTraits', () => {
  it('désentrelace un master de diffusion entrelacé', () => {
    expect(sourceTraits({ fieldOrder: 'tt' })).toMatchObject({ deinterlace: true });
    expect(sourceTraits({ fieldOrder: 'bb' })).toMatchObject({ deinterlace: true });
  });

  it('laisse intact un master progressif — la passe coûterait une frame de netteté', () => {
    expect(sourceTraits({ fieldOrder: 'progressive' })).toMatchObject({ deinterlace: false });
    expect(sourceTraits({ fieldOrder: 'unknown' })).toMatchObject({ deinterlace: false });
    expect(sourceTraits({})).toEqual(NO_TRAITS);
  });

  it('downmixe le multicanal, jamais le mono ni le stéréo', () => {
    expect(sourceTraits({ audioChannels: 6 })).toMatchObject({ downmixStereo: true });
    expect(sourceTraits({ audioChannels: 8 })).toMatchObject({ downmixStereo: true });
    expect(sourceTraits({ audioChannels: 2 })).toMatchObject({ downmixStereo: false });
    expect(sourceTraits({ audioChannels: 1 })).toMatchObject({ downmixStereo: false });
  });

  it('sonde muette ou métadonnées douteuses : aucune décision prise', () => {
    expect(sourceTraits({ fieldOrder: 42, audioChannels: 'six' })).toEqual(NO_TRAITS);
  });
});

describe('preFiltersFor / audioOptionsFor', () => {
  it('pose yadif en tête de chaîne, avant le redimensionnement', () => {
    expect(preFiltersFor({ deinterlace: true, downmixStereo: false })).toEqual(['yadif']);
    expect(preFiltersFor(NO_TRAITS)).toEqual([]);
  });

  it('pose « -ac 2 » seulement quand le master dépasse deux canaux', () => {
    expect(audioOptionsFor({ deinterlace: false, downmixStereo: true })).toEqual(['-ac', '2']);
    expect(audioOptionsFor(NO_TRAITS)).toEqual([]);
  });
});
