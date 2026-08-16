// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { nextNumber, nextVersionName, versionNumber } from './versionNaming';

describe('versionNumber', () => {
  it('lit les deux conventions', () => {
    expect(versionNumber('V01')).toBe(1);
    expect(versionNumber('V002')).toBe(2);
    expect(versionNumber('DEMO_SH010_anim_v012')).toBe(12);
    expect(versionNumber('_model_v0001')).toBe(1);
  });

  it('retombe sur les chiffres finaux quand il n’y a pas de « v »', () => {
    expect(versionNumber('SH010_anim_3')).toBe(3);
  });

  it('ne devine pas un numéro là où il n’y en a pas', () => {
    expect(versionNumber('final')).toBeNull();
    expect(versionNumber('')).toBeNull();
  });
});

describe('nextNumber', () => {
  it('part de 1 sous un parent vide', () => {
    expect(nextNumber([])).toBe(1);
  });

  it('ne réutilise jamais un numéro déjà porté', () => {
    // Le défaut que ce module corrige : compter les versions (« il y en a 2, donc la
    // suivante est la 3 ») régresse dès qu'on en supprime une, et fabrique deux V03
    // qui ne désignent pas le même travail.
    expect(nextNumber(['V01', 'V02', 'V03'])).toBe(4);
    expect(nextNumber(['V01', 'V03'])).toBe(4); // V02 supprimée
  });

  it('mélange les conventions sans se tromper de rang', () => {
    // Un projet relié après coup porte les deux formes sous la même tâche.
    expect(nextNumber(['V01', 'DEMO_SH010_anim_v007'])).toBe(8);
  });

  it('ignore ce qui ne porte pas de numéro', () => {
    expect(nextNumber(['final', 'V02'])).toBe(3);
    expect(nextNumber(['final'])).toBe(1);
  });
});

describe('nextVersionName', () => {
  it('garde la forme courte hors projet relié', () => {
    expect(nextVersionName({ existing: [], linked: false, parentCode: 'SH010', step: 'anim' })).toBe('V01');
    expect(nextVersionName({ existing: ['V09'], linked: false })).toBe('V10');
  });

  it('suit la convention du site sur un projet relié', () => {
    expect(nextVersionName({ existing: [], linked: true, parentCode: 'DEMO_SH010', step: 'anim' })).toBe(
      'DEMO_SH010_anim_v001',
    );
  });

  it('reprend la numérotation là où le site l’a laissée', () => {
    expect(
      nextVersionName({
        existing: ['DEMO_SH010_anim_v001', 'DEMO_SH010_anim_v002'],
        linked: true,
        parentCode: 'DEMO_SH010',
        step: 'anim',
      }),
    ).toBe('DEMO_SH010_anim_v003');
  });

  it('se passe de l’étape quand la version ne pend à aucune tâche', () => {
    expect(nextVersionName({ existing: [], linked: true, parentCode: 'Cathedral' })).toBe('Cathedral_v001');
  });

  it('retombe sur la forme courte sans parent identifiable', () => {
    // « _anim_v001 » ne désignerait rien : mieux vaut un nom court mais lisible.
    expect(nextVersionName({ existing: [], linked: true, step: 'anim' })).toBe('V01');
  });

  it('réduit ce qui ne peut pas vivre dans un code', () => {
    expect(
      nextVersionName({ existing: [], linked: true, parentCode: 'Cathédrale (nef)', step: 'look dev' }),
    ).toBe('Cathdrale_nef_look_dev_v001');
  });
});
