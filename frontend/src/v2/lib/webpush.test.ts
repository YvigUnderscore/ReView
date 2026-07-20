import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array, pushSupported } from './webpush';

describe('webpush — urlBase64ToUint8Array (42.B №66)', () => {
  it('décode le base64url (avec - et _) et gère le padding manquant', () => {
    // « ab-_ » en base64url → base64 « ab+/ » (padding ajouté) → 3 octets.
    const out = urlBase64ToUint8Array('ab-_');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(3);
  });

  it('reproduit un décodage base64 connu', () => {
    // atob('QUJD') === 'ABC' → [65, 66, 67]
    expect(Array.from(urlBase64ToUint8Array('QUJD'))).toEqual([65, 66, 67]);
  });

  it('pushSupported renvoie un booléen (false sous happy-dom sans PushManager)', () => {
    expect(typeof pushSupported()).toBe('boolean');
  });
});
