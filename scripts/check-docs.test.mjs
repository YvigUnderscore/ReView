// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  RENDER_EXT,
  RENDER_MAX_BYTES,
  figureProblems,
  headingAnchors,
  missingPreamble,
  references,
  renderProblems,
  slugifyHeading,
} from './check-docs.mjs';

describe('slugifyHeading', () => {
  it('follows GitHub: lowercase, punctuation removed, each space turned into a dash', () => {
    expect(slugifyHeading('Playback quality')).toBe('playback-quality');
    expect(slugifyHeading('Transport & timeline')).toBe('transport--timeline');
    expect(slugifyHeading('  Loop (I/O points)  ')).toBe('loop-io-points');
  });

  it('keeps accents and underscores', () => {
    expect(slugifyHeading('Réglages hérités')).toBe('réglages-hérités');
    expect(slugifyHeading('MEDIA_ROOT')).toBe('media_root');
  });

  it('returns a valid anchor when nothing is left', () => {
    expect(slugifyHeading('***')).toBe('section');
  });
});

describe('headingAnchors', () => {
  it('collects the level 1 to 4 headings', () => {
    expect(headingAnchors('# A\n\n## B\n\n### C\n\n##### E\n')).toEqual(['a', 'b', 'c']);
  });

  it('numbers repeated headings, as the application does', () => {
    expect(headingAnchors('## Limits\n\n## Limits\n')).toEqual(['limits', 'limits-1']);
  });

  it('ignores a hash inside a code block', () => {
    expect(headingAnchors('## Vrai\n\n```bash\n# commentaire shell\n```\n')).toEqual(['vrai']);
  });

  it('strips inline markdown from the heading text', () => {
    expect(headingAnchors('## The **review** `workspace`\n')).toEqual(['the-review-workspace']);
  });
});

describe('missingPreamble', () => {
  const page = '# Video review\n\n*Frame-accurate playback.*\n\n> Updated: 2026-08-23\n\n## Transport\n';

  it('reports nothing for a compliant page', () => {
    expect(missingPreamble(page)).toEqual([]);
  });

  it('reports the missing title, subtitle and date', () => {
    expect(missingPreamble('Texte sans rien.\n')).toHaveLength(3);
  });

  it('does not take a bold paragraph for a subtitle', () => {
    expect(missingPreamble('# T\n\n**Gras.**\n\n> Updated: 2026-08-23\n')).toEqual([
      'sous-titre en italique (*…*)',
    ]);
  });

  it('requires a complete date', () => {
    expect(missingPreamble('# T\n\n*S.*\n\n> Updated: soon\n')).toEqual(['ligne « > Updated: AAAA-MM-JJ »']);
  });
});

describe('references', () => {
  it('distinguishes images from links', () => {
    expect(references('![Une figure](../assets/a.svg) et [une page](b.md)')).toEqual([
      { image: true, text: 'Une figure', target: '../assets/a.svg' },
      { image: false, text: 'une page', target: 'b.md' },
    ]);
  });

  it('ignores what lives in a code block — an example is not a link', () => {
    expect(references('```md\n[exemple](inexistant.md)\n```\n\n[vrai](a.md)')).toEqual([
      { image: false, text: 'vrai', target: 'a.md' },
    ]);
  });
});

describe('figureProblems', () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50" role="img" aria-labelledby="t">',
    '<title id="t">Titre</title>',
    '<style>.a{fill:#111}@media (prefers-color-scheme: dark){.a{fill:#eee}}</style>',
    '<g><rect class="a" x="0" y="0" width="10" height="10"/></g>',
    '</svg>',
  ].join('\n');

  it('reports nothing for a compliant figure', () => {
    expect(figureProblems(svg)).toEqual([]);
  });

  it('reports the absence of viewBox, size, title, role and dark variant', () => {
    expect(figureProblems('<svg xmlns="x"><rect/></svg>')).toHaveLength(5);
  });

  /**
   * `viewBox` alone only gives an aspect ratio. Without an intrinsic size, the figure
   * falls back to the browser's 300×150 default and its content spills out of the frame — this
   * is what happened to `brief-blocks.svg`, the only one of the 146 not to declare it.
   */
  it('requires an intrinsic size on the root, not just a viewBox', () => {
    const sansTaille = svg.replace(' width="100" height="50"', '');
    expect(figureProblems(sansTaille).join(' ')).toMatch(/width\/height/);

    // The size of an inner `<rect>` does not count: only the root's sizes the figure.
    const rectSeul = svg.replace('viewBox="0 0 100 50" width="100" height="50"', 'viewBox="0 0 100 50"');
    expect(figureProblems(rectSeul).join(' ')).toMatch(/width\/height/);
  });

  it('refuses the generic title and desc ids, which trample each other across figures', () => {
    const generique = svg
      .replace('aria-labelledby="t"', 'aria-labelledby="title"')
      .replace('id="t"', 'id="title"');
    expect(figureProblems(generique).join(' ')).toMatch(/id="title" générique/);

    const desc = svg.replace(
      '<title id="t">Titre</title>',
      '<title id="t">Titre</title><desc id="desc">D</desc>',
    );
    expect(figureProblems(desc).join(' ')).toMatch(/id="desc" générique/);
  });

  it('reports a tag left open', () => {
    const broken = svg.replace('</svg>', '');
    expect(figureProblems(broken).join(' ')).toMatch(/non fermée/);
  });

  it('does not take empty elements for open tags', () => {
    expect(
      figureProblems(
        svg.replace(
          '<rect class="a" x="0" y="0" width="10" height="10"/>',
          '<path d="M0 0"/><circle r="1"/><line x1="0"/>',
        ),
      ),
    ).toEqual([]);
  });
});

describe('renderProblems', () => {
  /** Real headers, truncated: the check only reads the first bytes. */
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from('ftypisom', 'latin1'),
    Buffer.alloc(64),
  ]);
  const webm = Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(64)]);
  const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64)]);

  it('reports nothing for a compliant render, whatever the container', () => {
    expect(renderProblems(mp4, 'assets/user-guide/a.mp4')).toEqual([]);
    expect(renderProblems(webm, 'assets/user-guide/a.webm')).toEqual([]);
    expect(renderProblems(gif, 'assets/user-guide/a.gif')).toEqual([]);
  });

  it('accepts the extension in uppercase — the file name is not the point', () => {
    expect(renderProblems(mp4, 'assets/user-guide/A.MP4')).toEqual([]);
  });

  it('refuses an extension outside the list of renders', () => {
    expect(renderProblems(mp4, 'assets/user-guide/a.mov').join(' ')).toMatch(/extension de rendu inconnue/);
  });

  it('reports an empty file — an interrupted render leaves zero bytes', () => {
    expect(renderProblems(Buffer.alloc(0), 'assets/user-guide/a.mp4')).toEqual([
      'fichier vide (rendu interrompu ?)',
    ]);
  });

  /**
   * The case that motivates this check: the file exists, so the image check lets it through,
   * but nothing can read it. A `.webm` renamed to `.mp4`, a truncated output, a Git-LFS
   * pointer left as text — all of them show in the header, none of them shows in the name.
   */
  it('reports content that does not match the extension', () => {
    expect(renderProblems(webm, 'assets/user-guide/a.mp4').join(' ')).toMatch(/n’est pas un MP4/);
    expect(
      renderProblems(Buffer.from('version https://git-lfs…'), 'assets/user-guide/a.webm').join(' '),
    ).toMatch(/n’est pas un WEBM/);
    expect(renderProblems(Buffer.from('GIF87b…'), 'assets/user-guide/a.gif').join(' ')).toMatch(
      /n’est pas un GIF/,
    );
  });

  it('accepts GIF87a just like GIF89a', () => {
    const ancien = Buffer.concat([Buffer.from('GIF87a', 'latin1'), Buffer.alloc(64)]);
    expect(renderProblems(ancien, 'assets/user-guide/a.gif')).toEqual([]);
  });

  it('caps the weight: DOCUMENTATION/ is versioned, the binary stays there', () => {
    const lourd = Buffer.concat([mp4, Buffer.alloc(RENDER_MAX_BYTES)]);
    expect(renderProblems(lourd, 'assets/user-guide/a.mp4').join(' ')).toMatch(/Mio > 4 Mio/);

    const juste = Buffer.concat([mp4, Buffer.alloc(RENDER_MAX_BYTES - mp4.length)]);
    expect(renderProblems(juste, 'assets/user-guide/a.mp4')).toEqual([]);
  });

  it('accumulates the complaints instead of stopping at the first', () => {
    const lourdEtFaux = Buffer.concat([webm, Buffer.alloc(RENDER_MAX_BYTES)]);
    expect(renderProblems(lourdEtFaux, 'assets/user-guide/a.mp4')).toHaveLength(2);
  });

  it('only announces lowercase extensions, as the scan compares them', () => {
    expect(RENDER_EXT).toEqual(RENDER_EXT.map((e) => e.toLowerCase()));
    expect(RENDER_EXT).toContain('.mp4');
  });
});
