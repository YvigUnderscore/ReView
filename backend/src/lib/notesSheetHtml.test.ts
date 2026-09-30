// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderNotesSheet, sanitizeInlineSvg, type SheetLabels, type SheetNote } from './notesSheetHtml';
import { annotationToSvg } from './annotationSvg';

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

/**
 * Le filtre a été pris en défaut le 2026-09-16 : sa règle des gestionnaires exigeait un
 * BLANC devant (`\son…=`), si bien qu'un `/onbegin=` — forme que l'analyseur HTML accepte
 * pour séparer deux attributs — traversait la planche intact. Ces tests fixent les formes
 * exactes qui passaient.
 */
describe('sanitizeInlineSvg — contournements', () => {
  it('rejette un gestionnaire introduit par un solidus', () => {
    const svg =
      '<svg><rect stroke="#fff"/><animate attributeName="x"/onbegin="fetch(\'https://evil.example\')" /></svg>';
    expect(sanitizeInlineSvg(svg)).toBeNull();
  });

  it('rejette un gestionnaire recollé au guillemet fermant du précédent', () => {
    expect(sanitizeInlineSvg('<svg><rect stroke="#fff"onload="alert(1)" /></svg>')).toBeNull();
  });

  it('rejette les balises d’animation, de style et de lien', () => {
    for (const tag of ['animate', 'set', 'animateTransform', 'style', 'a', 'switch', 'handler']) {
      expect(sanitizeInlineSvg(`<svg><${tag}>x</${tag}></svg>`)).toBeNull();
    }
  });

  it('rejette un commentaire, une instruction de traitement ou un chevron esseulé', () => {
    expect(sanitizeInlineSvg('<svg><!--<script>alert(1)</script>--></svg>')).toBeNull();
    expect(sanitizeInlineSvg('<svg><?xml-stylesheet href="x"?></svg>')).toBeNull();
    expect(sanitizeInlineSvg('<svg>< </svg>')).toBeNull();
  });

  it('rejette un href, seul moyen pour une forme de pointer ailleurs', () => {
    expect(sanitizeInlineSvg('<svg><text xlink:href="https://evil.example">x</text></svg>')).toBeNull();
  });

  it('laisse passer le SVG que le rendu produit réellement', () => {
    const svg = annotationToSvg(
      [
        { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: '#ef4444' },
        { type: 'arrow', x1: 0, y1: 0, x2: 0.5, y2: 0.5 },
        {
          type: 'path',
          pts: [
            [0, 0],
            [1, 1],
          ],
        },
        { type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 },
        { type: 'text', x: 0.2, y: 0.2, text: 'flicker' },
      ],
      1920,
      1080,
    );
    expect(sanitizeInlineSvg(svg)).toBe(svg);
  });

  it('laisse passer le rendu d’une couleur piégée, désormais neutralisée en amont', () => {
    // La défense est dans `annotationSvg` : le filtre n'a plus rien à rejeter.
    const svg = annotationToSvg(
      [{ type: 'rect', w: 0.1, h: 0.1, color: '#fff"/><animate attributeName="x"/onbegin="alert(1)' }],
      160,
      90,
    );
    expect(sanitizeInlineSvg(svg)).toBe(svg);
    expect(svg).not.toContain('onbegin');
  });
});

describe('renderNotesSheet — sources d’image', () => {
  const sheet = (src: string) =>
    renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [note({ image: { src, width: 160, height: 90 } })],
      truncated: null,
    });

  it('n’incruste que des data URI : le document se veut autonome', () => {
    const html = sheet('https://tracker.example/pixel.png');
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('No frame available');
  });

  it('refuse une source qui sortirait du url() CSS ou de l’attribut', () => {
    expect(sheet("data:image/png;base64,AAA');background-image:url('https://evil.example/x")).not.toContain(
      'evil.example',
    );
    expect(sheet('data:image/png;base64,AAA" onerror="alert(1)')).not.toContain('onerror');
  });

  it('refuse un SVG, seul format d’image qui embarque du balisage', () => {
    expect(sheet('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).not.toContain('svg+xml');
  });

  it('borne les dimensions écrites dans le style', () => {
    const html = renderNotesSheet({
      title: 't',
      subtitle: 's',
      labels,
      notes: [
        note({
          image: {
            src: 'data:image/jpeg;base64,AAA',
            width: NaN,
            height: -4,
            tile: { offsetX: NaN, offsetY: 1.6, sheetWidth: 1600, sheetHeight: 180 },
          },
        }),
      ],
      truncated: null,
    });
    expect(html).not.toContain('NaN');
    expect(html).toContain('background-position:-0px -2px');
  });
});
