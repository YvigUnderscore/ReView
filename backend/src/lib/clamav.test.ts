// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { frameChunk, parseClamResponse, ClamavRefusedError } from './clamav';

describe('clamav', () => {
  it('frameChunk: uint32 BE prefix + data, empty chunk = terminator', () => {
    const framed = frameChunk(Buffer.from('abc'));
    expect(framed.length).toBe(7);
    expect(framed.readUInt32BE(0)).toBe(3);
    expect(framed.subarray(4).toString()).toBe('abc');
    expect(frameChunk(Buffer.alloc(0)).readUInt32BE(0)).toBe(0);
  });

  it('parseClamResponse: OK / FOUND / unexpected', () => {
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

  /**
   * Reply observed on a real clamd configured with `StreamMaxLength 1M`, then `10M`:
   * `INSTREAM size limit exceeded. ERROR\0`, without a `stream:` prefix, followed by a connection
   * cut. On this product, where rushes weigh gigabytes, this is the common case: it must name the
   * setting to turn, not say "unexpected response".
   */
  it('parseClamResponse: a clamd refusal is recognised as such and points to clamd.conf', () => {
    expect(() => parseClamResponse('INSTREAM size limit exceeded. ERROR\0')).toThrow(ClamavRefusedError);
    try {
      parseClamResponse('INSTREAM size limit exceeded. ERROR\0');
      expect.unreachable('le refus doit lever');
    } catch (err) {
      expect(err).toBeInstanceOf(ClamavRefusedError);
      expect((err as ClamavRefusedError).reply).toBe('INSTREAM size limit exceeded. ERROR');
      expect((err as Error).message).toMatch(/StreamMaxLength/);
      expect((err as Error).message).toMatch(/MaxScanSize/);
    }
  });

  it('parseClamResponse: any other refusal stays readable, without invented advice', () => {
    const err = (() => {
      try {
        parseClamResponse('stream: Not a regular file. ERROR\0');
        return null;
      } catch (e) {
        return e as ClamavRefusedError;
      }
    })();
    expect(err).toBeInstanceOf(ClamavRefusedError);
    expect(err!.message).toContain('Not a regular file. ERROR');
    // No known setting for this refusal: we suggest nothing.
    expect(err!.message).not.toMatch(/StreamMaxLength/);
  });

  it('the file size qualifies the refusal when it is known', () => {
    const err = new ClamavRefusedError('INSTREAM size limit exceeded. ERROR', 412 * 1024 * 1024);
    expect(err.message).toContain('412.0 MB');
  });
});
