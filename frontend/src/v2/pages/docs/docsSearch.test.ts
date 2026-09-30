// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { docWords, filterSections, matchingHeadings, searchDocs } from './docsSearch';
import type { DocsSection } from './docsManifest';

/**
 * Le moteur commun au sommaire de `/docs` et à la palette Ctrl+K.
 *
 * Le défaut qu'il répare : le filtre du sommaire ignorait les titres de chapitre, que la
 * palette exploitait. Chercher « watermark » dans la page de documentation ne rendait donc
 * rien, alors que Ctrl+K ouvrait la bonne page sur le bon chapitre — deux réponses
 * contradictoires à la même question. Les tests ci-dessous portent sur le moteur partagé ;
 * ceux de la palette (`components/palette/surfaceSearch.test.ts`) vérifient son habillage.
 */

const page = (path: string, title: string, summary = '', headings: string[] = []) => ({
  path,
  title,
  summary,
  updated: '2026-09-20',
  headings,
});

const sections: DocsSection[] = [
  {
    dir: 'user-guide',
    label: 'User Guide',
    pages: [
      page('user-guide/review-video.md', 'Video review', 'Frame-accurate playback and comparison.', [
        'Transport & timeline',
        'Safe areas',
      ]),
      page('user-guide/boards.md', 'Boards'),
      page('user-guide/sharing.md', 'Sharing with clients', 'One link, and what it bounds.', [
        'Video source, watermark, downloads',
      ]),
    ],
  },
  {
    dir: 'admin-guide',
    label: 'Admin Guide',
    pages: [
      page('admin-guide/secure-distribution.md', 'Secure distribution', 'Everything that leaves.', [
        'Four défences',
        'Viewer watermark',
      ]),
    ],
  },
];

describe('docWords', () => {
  it('replie la casse et les accents, et découpe sur les espaces', () => {
    expect(docWords('  DÉFENCES  Watermark ')).toEqual(['defences', 'watermark']);
  });
  it('rend une liste vide sur une saisie vide — tout passe alors', () => {
    expect(docWords('   ')).toEqual([]);
  });
});

describe('filterSections', () => {
  it('sans requête, rend tout', () => {
    expect(filterSections(sections, '  ')).toEqual(sections);
  });

  it('filtre par titre (insensible à la casse) et retire les sections vides', () => {
    const out = filterSections(sections, 'VIDEO review');
    expect(out).toHaveLength(1);
    expect(out[0].pages.map((p) => p.path)).toEqual(['user-guide/review-video.md']);
  });

  it('filtre aussi par chemin', () => {
    const out = filterSections(sections, 'boards.md');
    expect(out.flatMap((s) => s.pages.map((p) => p.path))).toEqual(['user-guide/boards.md']);
  });

  it('cherche jusque dans le sous-titre — c’est là que vivent les mots du lecteur', () => {
    const out = filterSections(sections, 'comparison');
    expect(out.flatMap((s) => s.pages.map((p) => p.path))).toEqual(['user-guide/review-video.md']);
  });

  /** Le défaut de départ : ce mot ne vit que dans des titres de chapitre. */
  it('trouve une page par un TITRE DE CHAPITRE, comme la palette', () => {
    const out = filterSections(sections, 'watermark');
    expect(out.flatMap((s) => s.pages.map((p) => p.path))).toEqual([
      'user-guide/sharing.md',
      'admin-guide/secure-distribution.md',
    ]);
  });

  it('exige tous les mots', () => {
    expect(filterSections(sections, 'watermark boards')).toEqual([]);
  });

  it('ignore les accents des deux côtés', () => {
    for (const typed of ['defences', 'DÉFENCES'])
      expect(
        filterSections(sections, typed).flatMap((s) => s.pages.map((p) => p.title)),
        typed,
      ).toEqual(['Secure distribution']);
  });

  it('garde l’ordre de lecture du sommaire — on ne classe pas un sommaire, on le raye', () => {
    const out = filterSections(sections, 'video');
    expect(out.map((s) => s.dir)).toEqual(['user-guide']);
    expect(out[0].pages.map((p) => p.path)).toEqual(['user-guide/review-video.md', 'user-guide/sharing.md']);
  });

  it('reste filtrable sur un manifest sans chapitres (build antérieur)', () => {
    const old: DocsSection[] = [
      {
        dir: 'api',
        label: 'Api',
        pages: [{ ...page('api/overview.md', 'API overview'), headings: undefined }],
      },
    ];
    expect(filterSections(old, 'overview')).toHaveLength(1);
    expect(filterSections(old, 'watermark')).toEqual([]);
  });
});

describe('matchingHeadings', () => {
  const target = sections[1].pages[0];

  it('rend les chapitres qui portent la recherche — la raison du résultat', () => {
    expect(matchingHeadings(target, docWords('watermark'))).toEqual(['Viewer watermark']);
  });

  it('un seul mot suffit ici : la page a déjà répondu, on cherche par où y entrer', () => {
    expect(matchingHeadings(target, docWords('watermark defences'))).toEqual([
      'Four défences',
      'Viewer watermark',
    ]);
  });

  it('borne la liste — le sommaire reste lisible', () => {
    expect(matchingHeadings(target, docWords('e'), 1)).toHaveLength(1);
  });

  it('ne rend rien sans recherche, ni sur une page sans chapitre', () => {
    expect(matchingHeadings(target, [])).toEqual([]);
    expect(matchingHeadings(sections[0].pages[1], docWords('boards'))).toEqual([]);
  });
});

describe('searchDocs', () => {
  it('place le titre avant le chapitre : ce qui porte le mot passe devant ce qui le mentionne', () => {
    const hits = searchDocs(sections, 'video');
    expect(hits.map((h) => h.page.title)).toEqual(['Video review', 'Sharing with clients']);
  });

  it('nomme le chapitre trouvé', () => {
    const [hit] = searchDocs(sections, 'watermark');
    expect(hit.page.title).toBe('Sharing with clients');
    expect(hit.heading).toBe('Video source, watermark, downloads');
  });

  it('ne rend rien sur une saisie vide — un classement n’est pas un sommaire', () => {
    expect(searchDocs(sections, '  ')).toEqual([]);
  });
});
