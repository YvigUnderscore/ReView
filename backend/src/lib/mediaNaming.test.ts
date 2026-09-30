// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { extensionFor, safeCode, sgMediaName } from './mediaNaming';

describe('extensionFor', () => {
  it('prend celle du fichier livré', () => {
    expect(extensionFor('playblast_final.MOV', 'video/mp4')).toBe('.mov');
  });

  it('retombe sur le type déclaré quand le fichier n’en porte pas', () => {
    expect(extensionFor('playblast', 'video/quicktime')).toBe('.mov');
    expect(extensionFor('playblast', 'video/mp4; codecs=avc1')).toBe('.mp4');
  });

  it('rend une chaîne vide quand rien ne renseigne', () => {
    expect(extensionFor('playblast', 'application/x-inconnu')).toBe('');
    expect(extensionFor('playblast', null)).toBe('');
  });
});

describe('safeCode', () => {
  it('neutralise ce qui fabriquerait un segment de chemin', () => {
    // La clé de stockage est un chemin : un `/` y ajouterait un dossier.
    expect(safeCode('SH010/../evil')).toBe('SH010___evil');
    expect(safeCode('SH010\\comp')).toBe('SH010_comp');
  });

  it('laisse un code ordinaire intact', () => {
    expect(safeCode('DEMO_SH010_comp_v003')).toBe('DEMO_SH010_comp_v003');
  });
});

describe('sgMediaName', () => {
  it('compose le code et l’extension du fichier', () => {
    expect(sgMediaName({ code: 'SH010_comp_v003', sourceFilename: 'playblast.mov' })).toBe(
      'SH010_comp_v003.mov',
    );
  });

  it('ne double pas une extension déjà portée par le code', () => {
    // Beaucoup de sites nomment la Version d'après le fichier.
    expect(sgMediaName({ code: 'SH010_comp_v003.mov', sourceFilename: 'x.mov' })).toBe('SH010_comp_v003.mov');
  });

  it('déduit l’extension du type quand le fichier n’en a pas', () => {
    expect(
      sgMediaName({ code: 'SH010_comp_v003', sourceFilename: 'blob', mimeType: 'video/quicktime' }),
    ).toBe('SH010_comp_v003.mov');
  });

  it('garde le nom du fichier quand le code est inexploitable', () => {
    expect(sgMediaName({ code: '   ', sourceFilename: 'playblast.mov' })).toBe('playblast.mov');
    expect(sgMediaName({ code: null, sourceFilename: 'playblast.mov' })).toBe('playblast.mov');
  });

  it('rend le code seul quand aucune extension n’est connue', () => {
    expect(sgMediaName({ code: 'SH010_comp_v003', sourceFilename: 'blob', mimeType: null })).toBe(
      'SH010_comp_v003',
    );
  });
});
