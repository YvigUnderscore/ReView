// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderNotesSheet, sanitizeInlineSvg, type SheetLabels, type SheetNote } from './notesSheetHtml';

/**
 * La planche est le seul HTML que ReView compose à partir de texte saisi par des
 * utilisateurs et que quelqu'un ouvrira dans un navigateur. Deux exigences : rien
 * d'exécutable ne doit y entrer, et la frame commentée doit s'y voir.
 */

const labels: SheetLabels = {
  frame: 'Frame',
  timecode: 'Timecode',
  state: 'State',
  decision: 'Decision',
  noFrame: 'No frame available',
  printHint: 'Print this page',
  empty: 'No notes to print here.',
  reply: 'Reply',
};

const note = (over: Partial<SheetNote> = {}): SheetNote => ({
  location: 'SQ010 · SH020 › comp · v003',
  frame: '1024',
  timecode: '00:00:00:23',
  author: 'Alice',
  createdAt: '2026-08-21 10:30',
  state: 'OPEN',
  decision: 'Retake',
  text: 'flicker à gauche',
  image: null,
  annotationSvg: null,
  reply: false,
  ...over,
});

describe('sanitizeInlineSvg', () => {
  it('laisse passer un SVG d’annotation ordinaire', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" stroke="#FF3B30" /></svg>';
    expect(sanitizeInlineSvg(svg)).toBe(svg);
  });

  it('rejette un SVG dont une couleur a refermé l’attribut pour poser un gestionnaire', () => {
    const svg = '<svg><rect stroke="" onload="alert(1)" /></svg>';
    expect(sanitizeInlineSvg(svg)).toBeNull();
  });

  it('rejette script, foreignObject et URL exécutable', () => {
    expect(sanitizeInlineSvg('<svg><script>alert(1)</script></svg>')).toBeNull();
    expect(sanitizeInlineSvg('<svg><foreignObject><b>x</b></foreignObject></svg>')).toBeNull();
    expect(sanitizeInlineSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBeNull();
  });

  it('rend null quand il n’y a rien à dessiner', () => {
    expect(sanitizeInlineSvg(null)).toBeNull();
  });
});

describe('renderNotesSheet', () => {
  it('compose un document autonome avec le titre et l’aide à l’impression', () => {
    const html = renderNotesSheet({
      title: 'Review notes',
      subtitle: 'Projet — SH020',
      labels,
      notes: [],
      truncated: null,
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Review notes</title>');
    expect(html).toContain('Print this page');
    expect(html).toContain('No notes to print here.');
  });

  it('échappe le texte d’une note qui contient du balisage', () => {
    const html = renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [note({ text: '<img src=x onerror=alert(1)>' })],
      truncated: null,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('affiche le repère de temps, l’état et la décision de chaque note', () => {
    const html = renderNotesSheet({ title: 't', subtitle: 's', labels, notes: [note()], truncated: null });
    expect(html).toContain('Frame <b>1024</b>');
    expect(html).toContain('Timecode <b>00:00:00:23</b>');
    expect(html).toContain('Decision <b>Retake</b>');
    expect(html).toContain('SQ010 · SH020 › comp · v003');
  });

  it('découpe la vignette dans la sprite et pose l’annotation par-dessus', () => {
    const html = renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [
        note({
          image: {
            src: 'data:image/jpeg;base64,AAA',
            width: 160,
            height: 90,
            tile: { offsetX: 320, offsetY: 90, sheetWidth: 1600, sheetHeight: 180 },
          },
          annotationSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" /></svg>',
        }),
      ],
      truncated: null,
    });
    expect(html).toContain('background-position:-320px -90px');
    expect(html).toContain('background-size:1600px 180px');
    expect(html).toContain('<rect x="1" />');
  });

  it('annonce le repli quand aucune image n’est disponible', () => {
    const html = renderNotesSheet({ title: 't', subtitle: 's', labels, notes: [note()], truncated: null });
    expect(html).toContain('No frame available');
  });

  it('met une réponse en retrait et signale la troncature', () => {
    const html = renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [note({ reply: true })],
      truncated: 'Only the first 200 notes are shown.',
    });
    expect(html).toContain('note--reply');
    expect(html).toContain('Only the first 200 notes are shown.');
  });
});
