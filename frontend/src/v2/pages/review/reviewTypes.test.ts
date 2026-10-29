// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import {
  tcFromFrame,
  formatTime,
  findCompareMedia,
  safePlay,
  cancelPendingPlay,
  createSeekCoalescer,
  splitAnnotationParts,
  VIEWER_ZONE,
  VIEWER_ZONE_FULLSCREEN,
  viewerZone,
} from './reviewTypes';

describe('splitAnnotationParts — in→out range (34.A)', () => {
  it('extracts the range part and excludes it from the shapes', () => {
    const out = splitAnnotationParts([
      { type: 'range', inFrame: 10, outFrame: 40 },
      { type: 'pen', points: [] },
    ]);
    expect(out.range).toEqual({ inFrame: 10, outFrame: 40 });
    expect(out.shapes).toHaveLength(1);
    expect((out.shapes[0] as { type: string }).type).toBe('pen');
  });

  it('invalid range (out ≤ in, missing fields) → null', () => {
    expect(splitAnnotationParts([{ type: 'range', inFrame: 40, outFrame: 10 }]).range).toBeNull();
    expect(splitAnnotationParts([{ type: 'range', inFrame: 5 }]).range).toBeNull();
    expect(splitAnnotationParts([{ type: 'pen' }]).range).toBeNull();
    expect(splitAnnotationParts(null).range).toBeNull();
  });
});

describe('tcFromFrame', () => {
  it('converts a frame number into HH:MM:SS:FF timecode', () => {
    expect(tcFromFrame(0, 24)).toBe('00:00:00:00');
    expect(tcFromFrame(23, 24)).toBe('00:00:00:23');
    expect(tcFromFrame(24, 24)).toBe('00:00:01:00');
    expect(tcFromFrame(24 * 60, 24)).toBe('00:01:00:00');
    expect(tcFromFrame(24 * 3600, 24)).toBe('01:00:00:00');
  });

  it('clamps negative frames to zero', () => {
    expect(tcFromFrame(-5, 24)).toBe('00:00:00:00');
  });

  it('handles non-integer fps (rounding of the frame counter)', () => {
    expect(tcFromFrame(29, 29.97)).toBe('00:00:00:29');
  });
});

describe('formatTime', () => {
  it('formats seconds as MM:SS', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65.7)).toBe('01:05');
    expect(formatTime(600)).toBe('10:00');
  });
});

describe('safePlay — no sound on a frozen frame', () => {
  /** Minimal video element stub (readyState driven, listeners captured). */
  function fakeVideo(readyState: number) {
    const listeners = new Map<string, () => void>();
    const v = {
      readyState,
      paused: true,
      playbackRate: 2,
      currentTime: 10,
      play: vi.fn(async () => undefined),
      addEventListener: vi.fn((ev: string, fn: () => void) => listeners.set(ev, fn)),
      removeEventListener: vi.fn((ev: string) => listeners.delete(ev)),
    };
    return { v: v as unknown as HTMLVideoElement, raw: v, listeners };
  }

  it('decodable frame (readyState ≥ 3): immediate playback at speed 1', () => {
    const { v, raw } = fakeVideo(4);
    safePlay(v);
    expect(raw.play).toHaveBeenCalledOnce();
    expect(raw.playbackRate).toBe(1);
    expect(raw.currentTime).toBe(10); // no needless micro-seek
  });

  it('missing data: in-place micro-seek, then playback deferred to canplay', () => {
    const { v, raw, listeners } = fakeVideo(2);
    safePlay(v);
    expect(raw.play).not.toHaveBeenCalled();
    expect(raw.currentTime).toBeCloseTo(9.999, 5); // micro-seek → hls.js reloads the segment
    listeners.get('canplay')?.();
    expect(raw.play).toHaveBeenCalledOnce();
  });

  it('cancelPendingPlay cancels a pending start (paused in the meantime)', () => {
    const { v, raw, listeners } = fakeVideo(1);
    safePlay(v);
    cancelPendingPlay(v);
    expect(raw.removeEventListener).toHaveBeenCalledWith('canplay', expect.any(Function));
    listeners.get('canplay')?.(); // even if the event arrives, no more playback
    expect(raw.play).not.toHaveBeenCalled();
  });
});

describe('createSeekCoalescer — scrub without flooding the player', () => {
  /** Video stub: `seeking` driven, `currentTime` observed, `seeked` triggerable. */
  function fakeVideo() {
    const listeners = new Map<string, () => void>();
    const v = {
      seeking: false,
      currentTime: 0,
      addEventListener: vi.fn((ev: string, fn: () => void) => listeners.set(ev, fn)),
      removeEventListener: vi.fn((ev: string) => listeners.delete(ev)),
    };
    return { v: v as unknown as HTMLVideoElement, raw: v, fireSeeked: () => listeners.get('seeked')?.() };
  }

  it('applies immediately when no seek is in progress, with beforeSeek', () => {
    const { v, raw } = fakeVideo();
    const before = vi.fn();
    const c = createSeekCoalescer(v, before);
    c.seek(3);
    expect(raw.currentTime).toBe(3);
    expect(before).toHaveBeenCalledOnce();
  });

  it('coalesces: keeps only the LAST position during an ongoing seek', () => {
    const { v, raw, fireSeeked } = fakeVideo();
    const c = createSeekCoalescer(v);
    c.seek(3); // applied
    raw.seeking = true;
    c.seek(4); // pending
    c.seek(5); // replaces the pending one
    c.seek(6); // replaces again
    expect(raw.currentTime).toBe(3); // nothing new until the seek finishes
    raw.seeking = false;
    fireSeeked();
    expect(raw.currentTime).toBe(6); // only the last position is applied
  });

  it('dispose removes the listener and forgets the pending seek', () => {
    const { v, raw, fireSeeked } = fakeVideo();
    const c = createSeekCoalescer(v);
    c.seek(3);
    raw.seeking = true;
    c.seek(9);
    c.dispose();
    fireSeeked();
    expect(raw.currentTime).toBe(3); // the pending seek is forgotten
    expect(raw.removeEventListener).toHaveBeenCalledWith('seeked', expect.any(Function));
  });
});

describe('findCompareMedia — A/B comparison (video & image)', () => {
  const media = [
    { id: 10, kind: 'IMAGE' },
    { id: 11, kind: 'VIDEO' },
    { id: 12, kind: 'VIDEO' },
  ];

  it('returns the first media of the requested type', () => {
    expect(findCompareMedia(media, 99, 'VIDEO')).toBe(11);
    expect(findCompareMedia(media, 99, 'IMAGE')).toBe(10);
  });

  it('excludes the current media and returns null without another media of the type', () => {
    expect(findCompareMedia([{ id: 11, kind: 'VIDEO' }], 11, 'VIDEO')).toBeNull();
    expect(findCompareMedia([{ id: 10, kind: 'MODEL_3D' }], 99, 'VIDEO')).toBeNull();
    expect(findCompareMedia([], 99, 'IMAGE')).toBeNull();
  });
});

describe('VIEWER_ZONE_FULLSCREEN — media zone in video full screen', () => {
  const positions = (cls: string) =>
    cls.split(/\s+/).filter((c) => ['static', 'fixed', 'absolute', 'relative', 'sticky'].includes(c));

  it('covers the whole pane rather than staying in the flow', () => {
    expect(positions(VIEWER_ZONE_FULLSCREEN)).toEqual(['absolute']);
    expect(VIEWER_ZONE_FULLSCREEN).toContain('inset-0');
  });

  it('does not keep the flow classes of the normal zone', () => {
    // The full-screen pane is not a flex container: `flex-1` would size nothing there, and a second
    // `position` (that of VIEWER_ZONE) took precedence in the Tailwind sheet: the video then kept the
    // size measured before full screen.
    expect(VIEWER_ZONE_FULLSCREEN).not.toContain('flex-1');
    expect(positions(VIEWER_ZONE)).toEqual(['relative']);
  });

  it('viewerZone renders the zone of the current mode', () => {
    expect(viewerZone(true)).toBe(VIEWER_ZONE_FULLSCREEN);
    expect(viewerZone(false)).toBe(VIEWER_ZONE);
  });
});
