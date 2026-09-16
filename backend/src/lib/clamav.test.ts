// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { frameChunk, parseClamResponse, ClamavRefusedError } from './clamav';

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

  /**
   * Réponse relevée au fil, contre un vrai clamd configuré `StreamMaxLength 1M` puis
   * `10M` : `INSTREAM size limit exceeded. ERROR\0`, sans préfixe `stream:`, suivie d'une
   * coupure de connexion. Sur ce produit, où les rushes pèsent des gigaoctets, c'est le cas
   * courant — il doit donc nommer la manette à tourner, pas « réponse inattendue ».
   */
  it('parseClamResponse : un refus de clamd est reconnu comme tel et oriente vers clamd.conf', () => {
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

  it('parseClamResponse : tout autre refus reste lisible, sans conseil inventé', () => {
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
    // Aucune manette connue pour ce refus-là : on ne suggère rien.
    expect(err!.message).not.toMatch(/StreamMaxLength/);
  });

  it('la taille du fichier qualifie le refus quand elle est connue', () => {
    const err = new ClamavRefusedError('INSTREAM size limit exceeded. ERROR', 412 * 1024 * 1024);
    expect(err.message).toContain('412.0 MB');
  });
});
