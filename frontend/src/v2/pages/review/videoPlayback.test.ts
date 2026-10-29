// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { ASSEMBLING_POLL_MS, assemblingPollMs, isSequenceName, videoPlayback } from './videoPlayback';

/**
 * The video viewer must never stay silent: either it plays, or it says why it cannot — assembly in
 * progress, or failure with its retry.
 */

const media = (status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED', originalName = 'c_%04d.jpg') => ({
  status,
  originalName,
});

describe('isSequenceName', () => {
  it('recognizes the FFmpeg pattern of a sequence', () => {
    expect(isSequenceName('c_%04d.jpg')).toBe(true);
    expect(isSequenceName('SH0100_comp_v003.%04d.exr')).toBe(true);
  });

  it('does not confuse a video file with a sequence', () => {
    expect(isSequenceName('plan_v003.mov')).toBe(false);
    expect(isSequenceName('plan.1001.exr')).toBe(false);
  });
});

describe('videoPlayback', () => {
  it('announces the assembly of a sequence instead of reading its JSON manifest', () => {
    expect(videoPlayback(media('PROCESSING'), null)).toBe('assembling');
    expect(videoPlayback(media('UPLOADING'), null)).toBe('assembling');
  });

  it('shows the failure, so that it is readable and retryable', () => {
    expect(videoPlayback(media('FAILED'), null)).toBe('failed');
    expect(videoPlayback(media('FAILED', 'plan.mov'), null)).toBe('failed');
  });

  it('plays a video being processed from its original, as before', () => {
    expect(videoPlayback(media('PROCESSING', 'plan.mov'), null)).toBe('play');
  });

  it('plays as soon as a proxy exists, even after a failed retry', () => {
    expect(videoPlayback(media('READY'), 'https://s3/proxy.mp4')).toBe('play');
    expect(videoPlayback(media('FAILED'), 'https://s3/proxy.mp4')).toBe('play');
  });
});

describe('assemblingPollMs', () => {
  const data = (status: 'PROCESSING' | 'READY', kind: 'VIDEO' | 'IMAGE' = 'VIDEO') => ({
    media: { kind, status, originalName: 'c_%04d.jpg' },
    proxyUrl: null,
  });

  it('rereads the media as long as the sequence is assembling', () => {
    expect(assemblingPollMs(data('PROCESSING'))).toBe(ASSEMBLING_POLL_MS);
  });

  it('never rereads a readable media: presigned URLs would reload the player', () => {
    expect(assemblingPollMs(data('READY'))).toBe(false);
    expect(assemblingPollMs({ ...data('PROCESSING'), proxyUrl: 'https://s3/proxy.mp4' })).toBe(false);
    expect(assemblingPollMs(undefined)).toBe(false);
  });
});
