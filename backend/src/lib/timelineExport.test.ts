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
  it('donne une clé déterministe par montage', () => {
    expect(masterKey(12)).toBe('derived/timeline/12/master.mp4');
    expect(masterKey(12)).toBe(masterKey(12));
  });
});

describe('escapeDrawText', () => {
  it('neutralise les caractères que le parseur de filtres interprète', () => {
    expect(escapeDrawText('SQ010:SH020')).toBe('SQ010\\:SH020');
    expect(escapeDrawText("l'arrivée")).toBe("l\\'arrivée");
    expect(escapeDrawText('100%')).toBe('100\\%');
    expect(escapeDrawText('a\\b')).toBe('a\\\\b');
  });

  it('laisse un code de plan ordinaire intact', () => {
    expect(escapeDrawText('SH0100')).toBe('SH0100');
  });
});

describe('concatEntry / concatList', () => {
  it('cite le chemin selon la syntaxe du demuxer', () => {
    expect(concatEntry('/tmp/seg0.mp4')).toBe("file '/tmp/seg0.mp4'");
  });

  it("échappe l'apostrophe d'un chemin", () => {
    expect(concatEntry("/tmp/l'arrivée.mp4")).toBe("file '/tmp/l'\\''arrivée.mp4'");
  });

  it('termine la liste par un saut de ligne', () => {
    expect(concatList(['/a.mp4', '/b.mp4'])).toBe("file '/a.mp4'\nfile '/b.mp4'\n");
  });
});

describe('normalizeArgs', () => {
  it('impose résolution, cadence et piste audio communes', () => {
    const args = normalizeArgs(PROFILE).join(' ');
    expect(args).toContain('scale=1920:1080');
    expect(args).toContain('fps=24');
    expect(args).toContain('-ac 2');
    expect(args).toContain('setsar=1');
  });

  it('préserve le cadrage par lettrage plutôt que de déformer', () => {
    expect(normalizeArgs(PROFILE).join(' ')).toContain('force_original_aspect_ratio=decrease');
  });
});

describe('placeholder', () => {
  it('génère une source noire et une source silencieuse de même durée', () => {
    const inputs = placeholderInputs(PROFILE, 2.5);
    expect(inputs.video).toBe('color=c=black:s=1920x1080:r=24:d=2.5');
    expect(inputs.audio).toBe('anullsrc=channel_layout=stereo:sample_rate=48000:d=2.5');
  });

  it('impose une durée plancher pour ne pas produire un segment vide', () => {
    expect(placeholderInputs(PROFILE, 0).video).toContain('d=0.5');
    expect(placeholderInputs(PROFILE, -3).audio).toContain('d=0.5');
  });

  it('incruste le code du plan, échappé', () => {
    const filter = placeholderFilter(PROFILE, 'SQ010:SH020', 'no media');
    expect(filter).toContain('SQ010\\:SH020');
    expect(filter).toContain('x=(w-text_w)/2');
  });
});
