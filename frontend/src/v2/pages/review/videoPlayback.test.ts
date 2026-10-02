// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { ASSEMBLING_POLL_MS, assemblingPollMs, isSequenceName, videoPlayback } from './videoPlayback';

/**
 * Le viewer vidéo ne doit jamais rester muet : soit il lit, soit il dit pourquoi il ne peut
 * pas — assemblage en cours, ou échec avec sa relance.
 */

const media = (status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED', originalName = 'c_%04d.jpg') => ({
  status,
  originalName,
});

describe('isSequenceName', () => {
  it('reconnaît le motif FFmpeg d’une séquence', () => {
    expect(isSequenceName('c_%04d.jpg')).toBe(true);
    expect(isSequenceName('SH0100_comp_v003.%04d.exr')).toBe(true);
  });

  it('ne confond pas un fichier vidéo avec une séquence', () => {
    expect(isSequenceName('plan_v003.mov')).toBe(false);
    expect(isSequenceName('plan.1001.exr')).toBe(false);
  });
});

describe('videoPlayback', () => {
  it('annonce l’assemblage d’une séquence au lieu de lire son manifeste JSON', () => {
    expect(videoPlayback(media('PROCESSING'), null)).toBe('assembling');
    expect(videoPlayback(media('UPLOADING'), null)).toBe('assembling');
  });

  it('montre l’échec, pour qu’il soit lisible et relançable', () => {
    expect(videoPlayback(media('FAILED'), null)).toBe('failed');
    expect(videoPlayback(media('FAILED', 'plan.mov'), null)).toBe('failed');
  });

  it('lit une vidéo en cours de traitement depuis son original, comme avant', () => {
    expect(videoPlayback(media('PROCESSING', 'plan.mov'), null)).toBe('play');
  });

  it('lit dès qu’un proxy existe, même après une relance en échec', () => {
    expect(videoPlayback(media('READY'), 'https://s3/proxy.mp4')).toBe('play');
    expect(videoPlayback(media('FAILED'), 'https://s3/proxy.mp4')).toBe('play');
  });
});

describe('assemblingPollMs', () => {
  const data = (status: 'PROCESSING' | 'READY', kind: 'VIDEO' | 'IMAGE' = 'VIDEO') => ({
    media: { kind, status, originalName: 'c_%04d.jpg' },
    proxyUrl: null,
  });

  it('relit le média tant que la séquence s’assemble', () => {
    expect(assemblingPollMs(data('PROCESSING'))).toBe(ASSEMBLING_POLL_MS);
  });

  it('ne relit jamais un média lisible : les URLs présignées rechargeraient le lecteur', () => {
    expect(assemblingPollMs(data('READY'))).toBe(false);
    expect(assemblingPollMs({ ...data('PROCESSING'), proxyUrl: 'https://s3/proxy.mp4' })).toBe(false);
    expect(assemblingPollMs(undefined)).toBe(false);
  });
});
