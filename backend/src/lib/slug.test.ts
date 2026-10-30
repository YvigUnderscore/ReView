// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { slugify, slugifyFilename } from './slug';

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugify('Mon Plan Final')).toBe('mon-plan-final');
  });
  it('removes accents and diacritics', () => {
    expect(slugify('Éléphant àça')).toBe('elephant-aca');
  });
  it('compacts symbols and trims the edge dashes', () => {
    expect(slugify('  --Hello, World!--  ')).toBe('hello-world');
  });
  it('returns an empty string when there is no alphanumeric character', () => {
    expect(slugify('___!!!')).toBe('');
  });
});

describe('slugifyFilename', () => {
  it('preserves the extension by lowercasing it', () => {
    expect(slugifyFilename('Mon Plan Final.MOV')).toBe('mon-plan-final.mov');
  });
  it('slugifies a name without an extension', () => {
    expect(slugifyFilename('Sans Extension')).toBe('sans-extension');
  });
  it('falls back on "fichier" when the base name is empty', () => {
    expect(slugifyFilename('???.png')).toBe('fichier.png');
  });
  it('ignores a non-alphanumeric extension', () => {
    expect(slugifyFilename('image.@@@')).toBe('image');
  });
});
