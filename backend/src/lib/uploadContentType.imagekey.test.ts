// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { imageTypeFromKey, OPAQUE_CONTENT_TYPE } from './uploadContentType';

/**
 * Avatars, the studio logo and attachments are uploaded via presigned PUT, whose signature does
 * NOT cover the Content-Type sent: the stored type therefore comes from the browser. The key,
 * however, is built by the server from an already validated type.
 */
describe('imageTypeFromKey', () => {
  it('deduces the image type from the extension', () => {
    expect(imageTypeFromKey('branding/logo-1700.png')).toBe('image/png');
    expect(imageTypeFromKey('avatars/12/a.webp')).toBe('image/webp');
    expect(imageTypeFromKey('avatars/12/a.jpg')).toBe('image/jpeg');
    expect(imageTypeFromKey('avatars/12/a.JPEG')).toBe('image/jpeg');
  });

  it('makes any unrecognized extension opaque rather than guessing', () => {
    for (const k of ['x/y.html', 'x/y.svg', 'x/y', 'x/y.exe'])
      expect(imageTypeFromKey(k), k).toBe(OPAQUE_CONTENT_TYPE);
  });
});
