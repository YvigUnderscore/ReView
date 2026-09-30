// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { slugify, slugifyFilename } from './slug';

describe('slugify', () => {
  it('met en minuscules et remplace les espaces par des tirets', () => {
    expect(slugify('Mon Plan Final')).toBe('mon-plan-final');
  });
  it('retire les accents/diacritiques', () => {
    expect(slugify('Éléphant àça')).toBe('elephant-aca');
  });
  it('compacte les symboles et trim les tirets de bord', () => {
    expect(slugify('  --Hello, World!--  ')).toBe('hello-world');
  });
  it('renvoie une chaîne vide si aucun caractère alphanumérique', () => {
    expect(slugify('___!!!')).toBe('');
  });
});

describe('slugifyFilename', () => {
  it("préserve l'extension en la mettant en minuscules", () => {
    expect(slugifyFilename('Mon Plan Final.MOV')).toBe('mon-plan-final.mov');
  });
  it('slugifie un nom sans extension', () => {
    expect(slugifyFilename('Sans Extension')).toBe('sans-extension');
  });
  it('retombe sur « fichier » quand le nom de base est vide', () => {
    expect(slugifyFilename('???.png')).toBe('fichier.png');
  });
  it('ignore une extension non alphanumérique', () => {
    expect(slugifyFilename('image.@@@')).toBe('image');
  });
});
