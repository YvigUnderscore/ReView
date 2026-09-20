// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { foldKeepingLength, highlightDocHtml, matchSpans } from './docsHighlight';
import { extractChapters, renderDocHtml, slugifyHeading, type CalloutLabels } from './docsRender';

/**
 * Surlignage du terme cherché dans la page ouverte.
 *
 * Le piège de cette fonction est connu d'avance : le contenu est du **HTML généré**. Un
 * `replace()` sur la chaîne repeindrait un nom de classe, un `href` ou un identifiant
 * d'ancre, et un `<mark>` ouvert au milieu d'une balise casserait la page. Les tests
 * ci-dessous verrouillent les trois propriétés qui l'interdisent : on ne touche qu'au texte,
 * on ne casse ni le balisage ni les ancres, et la saisie de l'utilisateur ne peut rien
 * injecter.
 */

const text = (html: string): string => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent ?? '';
};

/** Toutes les ancres de la page, dans l'ordre — ce qu'un surlignage ne doit jamais déplacer. */
const anchors = (html: string): string[] => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return [...tpl.content.querySelectorAll('[id]')].map((el) => el.getAttribute('id') ?? '');
};

describe('foldKeepingLength', () => {
  it('replie casse et accents SANS changer la longueur — les positions doivent rester valides', () => {
    for (const sample of ['Défences', 'ÉÀÇ', 'plain text', 'Ærø', '中文', 'á'])
      expect(foldKeepingLength(sample).length, sample).toBe(sample.length);
    expect(foldKeepingLength('Défences')).toBe('defences');
  });
});

describe('matchSpans', () => {
  it('rend chaque occurrence, de gauche à droite', () => {
    expect(matchSpans('note and note again', ['note'])).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });

  it('fusionne les occurrences qui se chevauchent — un seul surlignage, pas deux imbriqués', () => {
    expect(matchSpans('watermarking', ['watermark', 'marking'])).toEqual([{ start: 0, end: 12 }]);
  });

  it('désigne les mêmes caractères qu’avant repli', () => {
    const source = 'Les défences du studio';
    const [span] = matchSpans(source, ['defences']);
    expect(source.slice(span.start, span.end)).toBe('défences');
  });
});

describe('highlightDocHtml', () => {
  it('enveloppe le terme trouvé dans un <mark>, et compte les occurrences', () => {
    const out = highlightDocHtml('<p>The watermark, then the watermark again.</p>', 'watermark');
    expect(out.count).toBe(2);
    expect(out.html).toContain('<mark class="doc-hit" data-doc-hit="first">watermark</mark>');
    expect(out.html).toContain('<mark class="doc-hit">watermark</mark>');
  });

  it('ne marque que la PREMIÈRE occurrence de la page — celle qu’on rejoint', () => {
    const out = highlightDocHtml('<p>note</p><p>note</p><p>note</p>', 'note');
    expect(out.html.match(/data-doc-hit="first"/g)).toHaveLength(1);
  });

  it('ne touche pas aux attributs : ancres, classes et liens sortent intacts', () => {
    const source =
      '<h2 id="viewer-watermark">Viewer watermark</h2>' +
      '<p><a data-doc="admin-guide/secure-distribution.md">watermark</a></p>';
    const out = highlightDocHtml(source, 'watermark');
    expect(out.html).toContain('id="viewer-watermark"');
    expect(out.html).toContain('data-doc="admin-guide/secure-distribution.md"');
    // Le mot du nom de classe n'est pas repeint : `doc-callout` survit à une recherche « note ».
    const callout = highlightDocHtml('<div class="doc-callout"><p>A note.</p></div>', 'note');
    expect(callout.html).toContain('class="doc-callout"');
    expect(callout.count).toBe(1);
  });

  it('ne casse pas la structure : le texte de la page est celui d’avant', () => {
    const source =
      '<div class="doc-table"><table><thead><tr><th>Setting</th></tr></thead>' +
      '<tbody><tr><td>Watermark</td></tr></tbody></table></div>';
    const out = highlightDocHtml(source, 'watermark');
    expect(text(out.html)).toBe(text(source));
    expect(out.html).toContain('<tbody>');
    expect(out.html).toContain('<mark');
  });

  it('surligne à accents près, sans décaler le texte', () => {
    const out = highlightDocHtml('<p>Les défences du studio.</p>', 'DEFENCES');
    expect(out.count).toBe(1);
    expect(out.html).toContain('>défences</mark>');
    expect(text(out.html)).toBe('Les défences du studio.');
  });

  it('se retire en effaçant le champ : sans recherche, la page est rendue telle quelle', () => {
    const source = '<p>The watermark.</p>';
    for (const query of ['', '   ', 'a'])
      expect(highlightDocHtml(source, query), query).toEqual({ html: source, count: 0 });
  });

  it('rend la page inchangée quand rien ne correspond', () => {
    const source = '<p>The watermark.</p>';
    expect(highlightDocHtml(source, 'kanban')).toEqual({ html: source, count: 0 });
  });

  it('n’injecte rien : ce qui ressemble à une balise reste du texte échappé', () => {
    // Le texte de la page contient « <b> » (échappé par renderDocHtml) et c'est lui que la
    // recherche trouve : le surlignage doit le reposer échappé, pas ouvrir une balise.
    const out = highlightDocHtml('<p>a &lt;b&gt; c</p>', '<b>');
    expect(out.count).toBe(1);
    expect(out.html).toContain('&lt;b&gt;</mark>');
    expect(out.html).not.toMatch(/<b>/);
    expect(text(out.html)).toBe('a <b> c');
  });

  it('préserve les entités du HTML rendu', () => {
    const out = highlightDocHtml('<p>1 &lt; 2 and a &amp; b</p>', 'and');
    expect(out.html).toContain('&lt;');
    expect(out.html).toContain('&amp;');
    expect(text(out.html)).toBe('1 < 2 and a & b');
  });
});

/**
 * Le moteur entier, bout à bout : une page de documentation telle qu'elle est écrite, rendue
 * par `renderDocHtml`, puis surlignée.
 *
 * C'est la composition qui compte ici, pas chaque pièce : le sommaire latéral navigue par
 * les **ancres** des titres et le panneau de chapitres les relit sur le HTML rendu. Si le
 * surlignage déplaçait une ancre ou renommait un chapitre, la page trouvée s'ouvrirait à
 * côté de ce qu'on cherchait — exactement le défaut qu'on répare.
 */
describe('composition avec le rendu markdown', () => {
  const LABELS: CalloutLabels = {
    note: 'Note',
    tip: 'Astuce',
    important: 'Important',
    warning: 'Avertissement',
    caution: 'Attention',
  };

  const MARKDOWN = [
    '# Secure distribution',
    '',
    '*Everything that leaves the studio.*',
    '',
    '> Updated: 2026-09-20',
    '',
    '## Viewer watermark',
    '',
    'The watermark is burnt into the [proxy](transcoding.md#renditions), never the source.',
    '',
    '> [!WARNING]',
    '> A watermark cannot be removed after publication.',
    '',
    '| Setting | Default |',
    '|---------|---------|',
    '| Watermark | `off` |',
    '',
    '```bash',
    'ffmpeg -i in.mp4 -vf "drawtext=text=watermark" out.mp4',
    '```',
    '',
    '### Défences on the share link',
    '',
    '![A share link carries the watermark policy.](../assets/admin-guide/share.svg)',
  ].join('\n');

  const rendered = renderDocHtml(MARKDOWN, 'admin-guide/secure-distribution.md', LABELS);

  it('surligne le terme partout où il se lit, titres et tableau compris', () => {
    const out = highlightDocHtml(rendered, 'watermark');
    // Titre de chapitre, paragraphe, encart, cellule, bloc de code et légende.
    expect(out.count).toBeGreaterThanOrEqual(6);
  });

  it('ne déplace aucune ancre et ne renomme aucun chapitre', () => {
    const out = highlightDocHtml(rendered, 'watermark');
    expect(anchors(out.html)).toEqual(anchors(rendered));
    expect(extractChapters(out.html)).toEqual(extractChapters(rendered));
    expect(text(out.html)).toBe(text(rendered));
  });

  it('laisse intacts les liens, les encarts et la structure du tableau', () => {
    const out = highlightDocHtml(rendered, 'watermark');
    expect(out.html).toContain('data-doc="admin-guide/transcoding.md#renditions"');
    expect(out.html).toContain('data-callout="warning"');
    expect(out.html).toContain('class="doc-table"');
    expect(out.html).toContain('<figcaption>');
  });

  /**
   * Le chemin que suit un clic sur un chapitre trouvé dans le sommaire : le libellé vient du
   * manifest, l'ancre est calculée à partir de lui, et elle doit désigner le titre rendu.
   */
  it('l’ancre calculée depuis un titre de chapitre existe dans la page rendue', () => {
    for (const heading of ['Viewer watermark', 'Défences on the share link'])
      expect(anchors(rendered), heading).toContain(slugifyHeading(heading));
  });

  it('surligne aussi un titre accentué sans casser son ancre', () => {
    const out = highlightDocHtml(rendered, 'defences');
    expect(out.count).toBe(1);
    expect(anchors(out.html)).toEqual(anchors(rendered));
    expect(out.html).toContain('>Défences</mark>');
  });
});
