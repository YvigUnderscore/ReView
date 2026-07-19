import { describe, it, expect } from 'vitest';
import { parseShotsCsv, toShotsCsv } from './projectCsv';

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
});
