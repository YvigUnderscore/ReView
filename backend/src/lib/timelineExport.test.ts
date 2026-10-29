// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  concatEntry,
  concatList,
  escapeDrawText,
  masterKey,
  normalizeArgs,
  placeholderFilter,
  placeholderInputs,
} from './timelineExport';

const PROFILE = { width: 1920, height: 1080, fps: 24 };

describe('masterKey', () => {
  it('returns a deterministic key per timeline', () => {
    expect(masterKey(12)).toBe('derived/timeline/12/master.mp4');
    expect(masterKey(12)).toBe(masterKey(12));
  });
});

describe('escapeDrawText', () => {
  it('neutralizes the characters the filter parser interprets', () => {
    expect(escapeDrawText('SQ010:SH020')).toBe('SQ010\\:SH020');
    expect(escapeDrawText("l'arrivée")).toBe("l\\'arrivée");
    expect(escapeDrawText('100%')).toBe('100\\%');
    expect(escapeDrawText('a\\b')).toBe('a\\\\b');
  });

  it('leaves an ordinary shot code intact', () => {
    expect(escapeDrawText('SH0100')).toBe('SH0100');
  });
});

describe('concatEntry / concatList', () => {
  it('quotes the path according to the demuxer syntax', () => {
    expect(concatEntry('/tmp/seg0.mp4')).toBe("file '/tmp/seg0.mp4'");
  });

  it("escapes the apostrophe in a path", () => {
    expect(concatEntry("/tmp/l'arrivée.mp4")).toBe("file '/tmp/l'\\''arrivée.mp4'");
  });

  it('ends the list with a newline', () => {
    expect(concatList(['/a.mp4', '/b.mp4'])).toBe("file '/a.mp4'\nfile '/b.mp4'\n");
  });
});

describe('normalizeArgs', () => {
  it('enforces a common resolution, frame rate and audio track', () => {
    const args = normalizeArgs(PROFILE).join(' ');
    expect(args).toContain('scale=1920:1080');
    expect(args).toContain('fps=24');
    expect(args).toContain('-ac 2');
    expect(args).toContain('setsar=1');
  });

  it('preserves the framing with letterboxing rather than distorting', () => {
    expect(normalizeArgs(PROFILE).join(' ')).toContain('force_original_aspect_ratio=decrease');
  });
});

describe('placeholder', () => {
  it('generates a black source and a silent source of the same duration', () => {
    const inputs = placeholderInputs(PROFILE, 2.5);
    expect(inputs.video).toBe('color=c=black:s=1920x1080:r=24:d=2.5');
    expect(inputs.audio).toBe('anullsrc=channel_layout=stereo:sample_rate=48000:d=2.5');
  });

  it('enforces a minimum duration so that no empty segment is produced', () => {
    expect(placeholderInputs(PROFILE, 0).video).toContain('d=0.5');
    expect(placeholderInputs(PROFILE, -3).audio).toContain('d=0.5');
  });

  it('overlays the shot code, escaped', () => {
    const filter = placeholderFilter(PROFILE, 'SQ010:SH020', 'no media');
    expect(filter).toContain('SQ010\\:SH020');
    expect(filter).toContain('x=(w-text_w)/2');
  });
});
