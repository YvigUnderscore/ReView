// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { detectDelimiter, parseShotsCsv, toCsvLine, toShotsCsv } from './projectCsv';
import { parseProjectCsv } from './projectCsvParse';

describe('projectCsv.detectDelimiter', () => {
  it('élit le séparateur le plus fréquent de l’en-tête', () => {
    expect(detectDelimiter('sequence,shot,name')).toBe(',');
    expect(detectDelimiter('sequence;shot;"nom, complet"')).toBe(';');
    expect(detectDelimiter('sequence\tshot')).toBe('\t');
    expect(detectDelimiter('shot')).toBe(',');
  });
});

describe('projectCsv.toCsvLine', () => {
  it('échappe et neutralise l’injection de formule', () => {
    expect(toCsvLine(['a,b', '=SUM(1)'])).toBe('"a,b",\'=SUM(1)');
  });
});

describe('projectCsv.parseShotsCsv (38.F)', () => {
  it('parse en-tête + lignes, tâches séparées par |', () => {
    const csv = 'sequence,shot,name,tasks\nSQ01,SH010,Intro,Anim|Comp\n,SH020,,\n';
    const { rows, errors } = parseShotsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { sequence: 'SQ01', shot: 'SH010', name: 'Intro', tasks: ['Anim', 'Comp'] },
      { sequence: null, shot: 'SH020', name: 'SH020', tasks: [] },
    ]);
  });

  it('erreur si colonne shot absente', () => {
    expect(parseShotsCsv('sequence,name\nSQ01,x').errors[0]).toMatch(/shot/);
  });

  it('signale un shot manquant et les doublons (même séquence)', () => {
    const { rows, errors } = parseShotsCsv('shot,name\nSH01,a\n,b\nSH01,c\n');
    expect(rows).toHaveLength(1); // seul le premier SH01 est retenu
    expect(errors.some((e) => /manquant/.test(e))).toBe(true); // ligne « ,b »
    expect(errors.some((e) => /double/.test(e))).toBe(true); // second SH01
  });

  it('supporte le délimiteur `;` et les champs entre guillemets', () => {
    const { rows } = parseShotsCsv('sequence;shot;name;tasks\nSQ01;SH01;"Plan, large";Anim');
    expect(rows[0]).toEqual({ sequence: 'SQ01', shot: 'SH01', name: 'Plan, large', tasks: ['Anim'] });
  });

  it('fichier vide → erreur', () => {
    expect(parseShotsCsv('   ').errors).toEqual(['Fichier vide']);
  });
});

describe('projectCsv.toShotsCsv (38.G)', () => {
  it('sérialise avec en-tête et échappe les champs, ré-importable', () => {
    const csv = toShotsCsv([
      { sequence: 'SQ01', shot: 'SH01', name: 'Plan, large', tasks: ['Anim', 'Comp'] },
      { sequence: null, shot: 'SH02', name: 'SH02', tasks: [] },
    ]);
    expect(csv.split('\n')[0]).toBe('sequence,shot,name,tasks');
    expect(csv).toContain('"Plan, large"');
    // Aller-retour : l'export se ré-importe à l'identique.
    const back = parseShotsCsv(csv).rows;
    expect(back[0]).toEqual({ sequence: 'SQ01', shot: 'SH01', name: 'Plan, large', tasks: ['Anim', 'Comp'] });
    expect(back[1]).toEqual({ sequence: null, shot: 'SH02', name: 'SH02', tasks: [] });
  });

  it('n’écrit une colonne facultative que si une ligne la renseigne', () => {
    const plain = toShotsCsv([{ sequence: null, shot: 'SH01', name: 'SH01', tasks: [] }]);
    expect(plain.split('\n')[0]).toBe('sequence,shot,name,tasks');
    const rich = toShotsCsv([
      { sequence: 'SQ01', shot: 'SH01', name: 'Intro', tasks: ['Anim'], episode: 'EP01', startFrame: 1001 },
    ]);
    expect(rich.split('\n')[0]).toBe('sequence,shot,name,tasks,episode,start_frame');
    // Les en-têtes enrichis se relisent par l'import : l'aller-retour reste possible.
    const back = parseProjectCsv(rich).entries[0];
    expect(back).toMatchObject({ episode: 'EP01', sequence: 'SQ01', shot: 'SH01', startFrame: 1001 });
  });

  it('neutralise l’injection de formule (CP-SEC) : préfixe apostrophe', () => {
    const csv = toShotsCsv([{ sequence: null, shot: '=cmd()', name: '@x', tasks: ['+y'] }]);
    const line = csv.split('\n')[1];
    expect(line).toContain("'=cmd()");
    expect(line).toContain("'@x");
    expect(line).toContain("'+y");
  });
});
