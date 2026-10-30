// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { audioOptionsFor, NO_TRAITS, preFiltersFor, sourceTraits } from './masterTraits';

describe('sourceTraits', () => {
  it('deinterlaces an interlaced broadcast master', () => {
    expect(sourceTraits({ fieldOrder: 'tt' })).toMatchObject({ deinterlace: true });
    expect(sourceTraits({ fieldOrder: 'bb' })).toMatchObject({ deinterlace: true });
  });

  it('leaves a progressive master intact — the pass would cost a frame of sharpness', () => {
    expect(sourceTraits({ fieldOrder: 'progressive' })).toMatchObject({ deinterlace: false });
    expect(sourceTraits({ fieldOrder: 'unknown' })).toMatchObject({ deinterlace: false });
    expect(sourceTraits({})).toEqual(NO_TRAITS);
  });

  it('downmixes multichannel audio, never mono or stereo', () => {
    expect(sourceTraits({ audioChannels: 6 })).toMatchObject({ downmixStereo: true });
    expect(sourceTraits({ audioChannels: 8 })).toMatchObject({ downmixStereo: true });
    expect(sourceTraits({ audioChannels: 2 })).toMatchObject({ downmixStereo: false });
    expect(sourceTraits({ audioChannels: 1 })).toMatchObject({ downmixStereo: false });
  });

  it('silent probe or doubtful metadata — no decision taken', () => {
    expect(sourceTraits({ fieldOrder: 42, audioChannels: 'six' })).toEqual(NO_TRAITS);
  });
});

describe('preFiltersFor / audioOptionsFor', () => {
  it('puts yadif at the head of the chain, before the resize', () => {
    expect(preFiltersFor({ deinterlace: true, downmixStereo: false })).toEqual(['yadif']);
    expect(preFiltersFor(NO_TRAITS)).toEqual([]);
  });

  it('sets "-ac 2" only when the master exceeds two channels', () => {
    expect(audioOptionsFor({ deinterlace: false, downmixStereo: true })).toEqual(['-ac', '2']);
    expect(audioOptionsFor(NO_TRAITS)).toEqual([]);
  });
});
