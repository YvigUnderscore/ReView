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
  it('suit GitHub : minuscules, ponctuation retirée, chaque espace devenu tiret', () => {
    expect(slugifyHeading('Playback quality')).toBe('playback-quality');
    expect(slugifyHeading('Transport & timeline')).toBe('transport--timeline');
    expect(slugifyHeading('  Loop (I/O points)  ')).toBe('loop-io-points');
  });

  it('conserve accents et tiret bas', () => {
    expect(slugifyHeading('Réglages hérités')).toBe('réglages-hérités');
    expect(slugifyHeading('MEDIA_ROOT')).toBe('media_root');
  });

  it('rend une ancre valable quand il ne reste rien', () => {
    expect(slugifyHeading('***')).toBe('section');
  });
});

describe('headingAnchors', () => {
  it('relève les titres de niveau 1 à 4', () => {
    expect(headingAnchors('# A\n\n## B\n\n### C\n\n##### E\n')).toEqual(['a', 'b', 'c']);
  });

  it('numérote les titres répétés, comme l’application', () => {
    expect(headingAnchors('## Limits\n\n## Limits\n')).toEqual(['limits', 'limits-1']);
  });

  it('ignore un dièse à l’intérieur d’un bloc de code', () => {
    expect(headingAnchors('## Vrai\n\n```bash\n# commentaire shell\n```\n')).toEqual(['vrai']);
  });

  it('retire le markdown en ligne du texte du titre', () => {
    expect(headingAnchors('## The **review** `workspace`\n')).toEqual(['the-review-workspace']);
  });
});

describe('missingPreamble', () => {
  const page = '# Video review\n\n*Frame-accurate playback.*\n\n> Updated: 2026-08-23\n\n## Transport\n';

  it('ne reproche rien à une page conforme', () => {
    expect(missingPreamble(page)).toEqual([]);
  });

  it('relève le titre, le sous-titre et la date manquants', () => {
    expect(missingPreamble('Texte sans rien.\n')).toHaveLength(3);
  });

  it('ne prend pas un paragraphe en gras pour un sous-titre', () => {
    expect(missingPreamble('# T\n\n**Gras.**\n\n> Updated: 2026-08-23\n')).toEqual([
      'sous-titre en italique (*…*)',
    ]);
  });

  it('exige une date complète', () => {
    expect(missingPreamble('# T\n\n*S.*\n\n> Updated: soon\n')).toEqual(['ligne « > Updated: AAAA-MM-JJ »']);
  });
});

describe('references', () => {
  it('distingue les images des liens', () => {
    expect(references('![Une figure](../assets/a.svg) et [une page](b.md)')).toEqual([
      { image: true, text: 'Une figure', target: '../assets/a.svg' },
      { image: false, text: 'une page', target: 'b.md' },
    ]);
  });

  it('ignore ce qui vit dans un bloc de code — un exemple n’est pas un lien', () => {
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

  it('ne reproche rien à une figure conforme', () => {
    expect(figureProblems(svg)).toEqual([]);
  });

  it('relève l’absence de viewBox, de taille, de titre, de rôle et de variante sombre', () => {
    expect(figureProblems('<svg xmlns="x"><rect/></svg>')).toHaveLength(5);
  });

  /**
   * `viewBox` seul ne donne qu'un rapport d'aspect. Sans taille intrinsèque, la figure
   * retombe sur les 300×150 par défaut du navigateur et son contenu sort du cadre — c'est
   * ce qui est arrivé à `brief-blocks.svg`, seule des 146 à ne pas la déclarer.
   */
  it('exige une taille intrinsèque sur la racine, pas seulement un viewBox', () => {
    const sansTaille = svg.replace(' width="100" height="50"', '');
    expect(figureProblems(sansTaille).join(' ')).toMatch(/width\/height/);

    // La taille d'un `<rect>` interne ne compte pas : seule celle de la racine dimensionne.
    const rectSeul = svg.replace('viewBox="0 0 100 50" width="100" height="50"', 'viewBox="0 0 100 50"');
    expect(figureProblems(rectSeul).join(' ')).toMatch(/width\/height/);
  });

  it('refuse les id génériques title et desc, qui se marchent dessus entre figures', () => {
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

  it('relève une balise laissée ouverte', () => {
    const broken = svg.replace('</svg>', '');
    expect(figureProblems(broken).join(' ')).toMatch(/non fermée/);
  });

  it('ne prend pas les éléments sans contenu pour des balises ouvertes', () => {
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
  /** En-têtes réels, tronqués : le contrôle ne lit que les premiers octets. */
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from('ftypisom', 'latin1'),
    Buffer.alloc(64),
  ]);
  const webm = Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(64)]);
  const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64)]);

  it('ne reproche rien à un rendu conforme, quel que soit le conteneur', () => {
    expect(renderProblems(mp4, 'assets/user-guide/a.mp4')).toEqual([]);
    expect(renderProblems(webm, 'assets/user-guide/a.webm')).toEqual([]);
    expect(renderProblems(gif, 'assets/user-guide/a.gif')).toEqual([]);
  });

  it('accepte l’extension en majuscules — le nom du fichier n’est pas le sujet', () => {
    expect(renderProblems(mp4, 'assets/user-guide/A.MP4')).toEqual([]);
  });

  it('refuse une extension hors de la liste des rendus', () => {
    expect(renderProblems(mp4, 'assets/user-guide/a.mov').join(' ')).toMatch(/extension de rendu inconnue/);
  });

  it('relève un fichier vide — un rendu interrompu laisse zéro octet', () => {
    expect(renderProblems(Buffer.alloc(0), 'assets/user-guide/a.mp4')).toEqual([
      'fichier vide (rendu interrompu ?)',
    ]);
  });

  /**
   * Le cas qui motive ce contrôle : le fichier existe, donc le contrôle d'image le laisse
   * passer, mais rien ne le lit. Un `.webm` renommé en `.mp4`, une sortie tronquée, un
   * pointeur Git-LFS resté texte — tous se voient à l'en-tête, aucun ne se voit au nom.
   */
  it('relève un contenu qui ne correspond pas à l’extension', () => {
    expect(renderProblems(webm, 'assets/user-guide/a.mp4').join(' ')).toMatch(/n’est pas un MP4/);
    expect(
      renderProblems(Buffer.from('version https://git-lfs…'), 'assets/user-guide/a.webm').join(' '),
    ).toMatch(/n’est pas un WEBM/);
    expect(renderProblems(Buffer.from('GIF87b…'), 'assets/user-guide/a.gif').join(' ')).toMatch(
      /n’est pas un GIF/,
    );
  });

  it('accepte GIF87a comme GIF89a', () => {
    const ancien = Buffer.concat([Buffer.from('GIF87a', 'latin1'), Buffer.alloc(64)]);
    expect(renderProblems(ancien, 'assets/user-guide/a.gif')).toEqual([]);
  });

  it('plafonne le poids : DOCUMENTATION/ est versionné, le binaire y reste', () => {
    const lourd = Buffer.concat([mp4, Buffer.alloc(RENDER_MAX_BYTES)]);
    expect(renderProblems(lourd, 'assets/user-guide/a.mp4').join(' ')).toMatch(/Mio > 4 Mio/);

    const juste = Buffer.concat([mp4, Buffer.alloc(RENDER_MAX_BYTES - mp4.length)]);
    expect(renderProblems(juste, 'assets/user-guide/a.mp4')).toEqual([]);
  });

  it('cumule les reproches plutôt que de s’arrêter au premier', () => {
    const lourdEtFaux = Buffer.concat([webm, Buffer.alloc(RENDER_MAX_BYTES)]);
    expect(renderProblems(lourdEtFaux, 'assets/user-guide/a.mp4')).toHaveLength(2);
  });

  it('n’annonce que des extensions en minuscules, comme les compare le balayage', () => {
    expect(RENDER_EXT).toEqual(RENDER_EXT.map((e) => e.toLowerCase()));
    expect(RENDER_EXT).toContain('.mp4');
  });
});
