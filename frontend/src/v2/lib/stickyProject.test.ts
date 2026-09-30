// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { pickStickyProject, readStoredProject } from './stickyProject';

describe('pickStickyProject', () => {
  it('préfère toujours le projet de la route', () => {
    expect(pickStickyProject(12, 7)).toBe(12);
  });

  it('retombe sur le dernier connu hors page de projet', () => {
    // C'est le cas visé : accueil, liste des projets ou reviews ne doivent pas vider
    // les sections du projet dans la barre latérale.
    expect(pickStickyProject(null, 7)).toBe(7);
  });

  it('rend null quand rien n’est connu', () => {
    expect(pickStickyProject(null, null)).toBeNull();
  });
});

describe('readStoredProject', () => {
  it('lit un identifiant valide', () => {
    expect(readStoredProject('461')).toBe(461);
  });

  it('ignore une valeur absente ou vide', () => {
    expect(readStoredProject(null)).toBeNull();
    expect(readStoredProject('')).toBeNull();
  });

  it('ignore ce qui n’est pas un identifiant plausible', () => {
    expect(readStoredProject('abc')).toBeNull();
    expect(readStoredProject('-3')).toBeNull();
    expect(readStoredProject('0')).toBeNull();
    expect(readStoredProject('1.5')).toBeNull();
  });
});
