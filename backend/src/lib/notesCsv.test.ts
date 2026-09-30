// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { NOTES_CSV_COLUMNS, csvField, flattenNoteText, toNotesCsv, type NoteCsvRow } from './notesCsv';

/**
 * Ce que le tableur reçoit. Deux choses comptent : que les colonnes ne bougent pas (un
 * studio branche des scripts dessus) et qu'un texte de note ne puisse pas s'exécuter à
 * l'ouverture du fichier.
 */

const row = (over: Partial<NoteCsvRow> = {}): NoteCsvRow => {
  const base = Object.fromEntries(NOTES_CSV_COLUMNS.map((c) => [c, ''])) as NoteCsvRow;
  return { ...base, ...over };
};

describe('csvField', () => {
  it('laisse un champ ordinaire intact', () => {
    expect(csvField('SH010')).toBe('SH010');
  });

  it('entoure de guillemets un champ qui porte le séparateur, un guillemet ou un saut de ligne', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('dit "non"')).toBe('"dit ""non"""');
    expect(csvField('deux\nlignes')).toBe('"deux\nlignes"');
  });

  it('neutralise une formule tableur', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('-2')).toBe("'-2");
  });
});

describe('flattenNoteText', () => {
  it('ramène un texte multi-lignes sur une seule ligne lisible', () => {
    expect(flattenNoteText('premier\n\n  second  \ntroisième')).toBe('premier ⏎ second ⏎ troisième');
  });

  it('rend une chaîne vide quand la note ne porte que des blancs', () => {
    expect(flattenNoteText('   \n\n ')).toBe('');
  });
});

describe('toNotesCsv', () => {
  it('écrit l’en-tête même sans note', () => {
    expect(toNotesCsv([])).toBe(NOTES_CSV_COLUMNS.join(','));
  });

  it('écrit une ligne par note, colonnes dans l’ordre déclaré', () => {
    const csv = toNotesCsv([
      row({
        note_id: '12',
        shot: 'SH010',
        frame: '1024',
        timecode: '00:00:00:23',
        author: 'Alice',
        state: 'OPEN',
        content: 'flicker à gauche',
      }),
      row({ note_id: '13', reply_to: '12', author: 'Bob', state: 'RESOLVED', content: 'corrigé' }),
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]?.split(',')[0]).toBe('note_id');
    expect(lines[1]).toContain('12,,,SH010');
    expect(lines[1]?.endsWith('flicker à gauche')).toBe(true);
    expect(lines[2]?.startsWith('13,12,')).toBe(true);
  });

  it('échappe le texte d’une note qui contient une virgule', () => {
    const csv = toNotesCsv([row({ note_id: '1', content: 'trop sombre, trop lent' })]);
    expect(csv.split('\n')[1]).toContain('"trop sombre, trop lent"');
  });
});
