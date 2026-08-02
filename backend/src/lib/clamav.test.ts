// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { frameChunk, parseClamResponse } from './clamav';

describe('clamav', () => {
  it('frameChunk : préfixe uint32 BE + données, chunk vide = terminateur', () => {
    const framed = frameChunk(Buffer.from('abc'));
    expect(framed.length).toBe(7);
    expect(framed.readUInt32BE(0)).toBe(3);
    expect(framed.subarray(4).toString()).toBe('abc');
    expect(frameChunk(Buffer.alloc(0)).readUInt32BE(0)).toBe(0);
  });

  it('parseClamResponse : OK / FOUND / inattendu', () => {
    expect(parseClamResponse('stream: OK\0')).toEqual({ clean: true, virus: null });
    expect(parseClamResponse('stream: Eicar-Signature FOUND\0')).toEqual({
      clean: false,
      virus: 'Eicar-Signature',
    });
    expect(parseClamResponse('stream: Win.Test.EICAR_HDB-1 FOUND\n')).toEqual({
      clean: false,
      virus: 'Win.Test.EICAR_HDB-1',
    });
    expect(() => parseClamResponse('ERROR: size limit')).toThrow();
  });
});
