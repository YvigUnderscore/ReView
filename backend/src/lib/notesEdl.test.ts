// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { framesAt, timecodeAt, timecodeFromFrames, toEdl } from './notesEdl';

/**
 * Un EDL est relu par un logiciel de montage : la moindre colonne de travers et l'import
 * échoue sans rien dire. On vérifie donc la forme des lignes autant que les timecodes.
 */

describe('timecodeFromFrames', () => {
  it('compte les frames dans la seconde', () => {
    expect(timecodeFromFrames(0, 24)).toBe('00:00:00:00');
    expect(timecodeFromFrames(23, 24)).toBe('00:00:00:23');
    expect(timecodeFromFrames(24, 24)).toBe('00:00:01:00');
    expect(timecodeFromFrames(24 * 3600, 24)).toBe('01:00:00:00');
  });

  it('arrondit la cadence fractionnaire (23,976 → 24 frames par seconde)', () => {
    expect(timecodeFromFrames(23, 23.976)).toBe('00:00:00:23');
    expect(timecodeFromFrames(24, 23.976)).toBe('00:00:01:00');
  });

  it('ne descend jamais sous zéro', () => {
    expect(timecodeFromFrames(-10, 25)).toBe('00:00:00:00');
    expect(framesAt(-3, 25)).toBe(0);
    expect(framesAt(2, 0)).toBe(0);
  });
});

describe('timecodeAt', () => {
  it('convertit des secondes', () => {
    expect(timecodeAt(1.5, 24)).toBe('00:00:01:12');
  });
});

describe('toEdl', () => {
  const edl = toEdl({
    title: 'Dailies\ndu jour',
    fps: 24,
    clips: [
      {
        name: 'SH010_comp_v003.mov',
        duration: 4,
        markers: [
          { at: 1.5, color: 'RED', label: 'Alice: flicker\nà gauche' },
          { at: 99, color: 'GREEN', label: 'Bob: ok' },
        ],
      },
      { name: 'SH020_comp_v001.mov', duration: 2, markers: [] },
      { name: 'carton vide', duration: 0, markers: [{ at: 0, color: 'CYAN', label: 'ignorée' }] },
    ],
  });
  const lines = edl.split('\n');

  it('ouvre par un titre sur une seule ligne et la cadence non-drop', () => {
    expect(lines[0]).toBe('TITLE: Dailies du jour');
    expect(lines[1]).toBe('FCM: NON-DROP FRAME');
  });

  it('numérote les événements et enchaîne les timecodes d’enregistrement', () => {
    expect(lines[3]).toBe('001  AX       V     C       00:00:00:00 00:00:04:00 00:00:00:00 00:00:04:00');
    expect(edl).toContain('002  AX       V     C       00:00:00:00 00:00:02:00 00:00:04:00 00:00:06:00');
  });

  it('donne le vrai nom du média en commentaire, le reel restant auxiliaire', () => {
    expect(lines[4]).toBe('* FROM CLIP NAME: SH010_comp_v003.mov');
  });

  it('pose une note par marqueur, au timecode d’enregistrement', () => {
    expect(lines[5]).toBe('* LOC: 00:00:01:12 RED Alice: flicker à gauche');
  });

  it('ramène dans le clip un marqueur posé au-delà de sa fin', () => {
    expect(lines[6]).toBe('* LOC: 00:00:03:23 GREEN Bob: ok');
  });

  it('saute un clip de durée nulle, marqueurs compris', () => {
    expect(edl).not.toContain('carton vide');
    expect(edl).not.toContain('ignorée');
  });
});

describe('toEdl — cas limites', () => {
  it('tronque un libellé démesuré', () => {
    const edl = toEdl({
      title: 'x',
      fps: 24,
      clips: [{ name: 'a', duration: 1, markers: [{ at: 0, color: 'WHITE', label: 'z'.repeat(400) }] }],
    });
    const loc = edl.split('\n').find((l) => l.startsWith('* LOC:'))!;
    expect(loc.length).toBeLessThan(220);
    expect(loc.endsWith('…')).toBe(true);
  });

  it('retombe sur 24 images par seconde quand la cadence est absurde', () => {
    const edl = toEdl({ title: 'x', fps: 0, clips: [{ name: 'a', duration: 1, markers: [] }] });
    expect(edl).toContain('00:00:01:00');
  });
});
