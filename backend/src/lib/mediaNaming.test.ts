// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { extensionFor, safeCode, sgMediaName } from './mediaNaming';

describe('extensionFor', () => {
  it('takes the extension of the delivered file', () => {
    expect(extensionFor('playblast_final.MOV', 'video/mp4')).toBe('.mov');
  });

  it('falls back on the declared type when the file carries none', () => {
    expect(extensionFor('playblast', 'video/quicktime')).toBe('.mov');
    expect(extensionFor('playblast', 'video/mp4; codecs=avc1')).toBe('.mp4');
  });

  it('returns an empty string when nothing gives a hint', () => {
    expect(extensionFor('playblast', 'application/x-inconnu')).toBe('');
    expect(extensionFor('playblast', null)).toBe('');
  });
});

describe('safeCode', () => {
  it('neutralises what would make a path segment', () => {
    // The storage key is a path: a `/` in it would add a folder.
    expect(safeCode('SH010/../evil')).toBe('SH010___evil');
    expect(safeCode('SH010\\comp')).toBe('SH010_comp');
  });

  it('leaves an ordinary code intact', () => {
    expect(safeCode('DEMO_SH010_comp_v003')).toBe('DEMO_SH010_comp_v003');
  });
});

describe('sgMediaName', () => {
  it('composes the code and the extension of the file', () => {
    expect(sgMediaName({ code: 'SH010_comp_v003', sourceFilename: 'playblast.mov' })).toBe(
      'SH010_comp_v003.mov',
    );
  });

  it('does not double an extension already carried by the code', () => {
    // Many sites name the Version after the file.
    expect(sgMediaName({ code: 'SH010_comp_v003.mov', sourceFilename: 'x.mov' })).toBe('SH010_comp_v003.mov');
  });

  it('infers the extension from the type when the file has none', () => {
    expect(
      sgMediaName({ code: 'SH010_comp_v003', sourceFilename: 'blob', mimeType: 'video/quicktime' }),
    ).toBe('SH010_comp_v003.mov');
  });

  it('keeps the file name when the code is unusable', () => {
    expect(sgMediaName({ code: '   ', sourceFilename: 'playblast.mov' })).toBe('playblast.mov');
    expect(sgMediaName({ code: null, sourceFilename: 'playblast.mov' })).toBe('playblast.mov');
  });

  it('returns the bare code when no extension is known', () => {
    expect(sgMediaName({ code: 'SH010_comp_v003', sourceFilename: 'blob', mimeType: null })).toBe(
      'SH010_comp_v003',
    );
  });
});
