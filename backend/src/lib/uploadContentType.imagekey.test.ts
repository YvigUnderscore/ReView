// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { imageTypeFromKey, OPAQUE_CONTENT_TYPE } from './uploadContentType';

/**
 * Les avatars, le logo studio et les pièces jointes sont déposés par PUT présigné, dont la
 * signature ne couvre PAS le Content-Type envoyé : le type stocké vient donc du navigateur.
 * La clé, elle, est construite par le serveur à partir d'un type déjà validé.
 */
describe('imageTypeFromKey', () => {
  it('déduit le type d’image de l’extension', () => {
    expect(imageTypeFromKey('branding/logo-1700.png')).toBe('image/png');
    expect(imageTypeFromKey('avatars/12/a.webp')).toBe('image/webp');
    expect(imageTypeFromKey('avatars/12/a.jpg')).toBe('image/jpeg');
    expect(imageTypeFromKey('avatars/12/a.JPEG')).toBe('image/jpeg');
  });

  it('rend opaque toute extension non reconnue plutôt que de deviner', () => {
    for (const k of ['x/y.html', 'x/y.svg', 'x/y', 'x/y.exe'])
      expect(imageTypeFromKey(k), k).toBe(OPAQUE_CONTENT_TYPE);
  });
});
