// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { htmlToText, preheader } from './mailText';

describe('htmlToText', () => {
  it('rend le texte d’un paragraphe, sans balises', () => {
    expect(htmlToText('<p>Bonjour <strong>Ada</strong>.</p>')).toBe('Bonjour Ada.');
  });

  it('garde l’adresse d’un lien à côté de son libellé', () => {
    // C'est tout l'intérêt : un bouton « Accepter l'invitation » sans son adresse est
    // inutilisable en texte brut.
    expect(htmlToText('<a href="https://review.test/invite/abc">Accepter l’invitation</a>')).toBe(
      'Accepter l’invitation (https://review.test/invite/abc)',
    );
  });

  it('ne répète pas l’adresse quand le libellé est déjà l’adresse', () => {
    expect(htmlToText('<a href="https://review.test">https://review.test</a>')).toBe('https://review.test');
  });

  it('rend une adresse seule quand le lien n’a pas de libellé', () => {
    expect(htmlToText('<a href="https://review.test"><img src="x"></a>')).toBe('https://review.test');
  });

  it('sépare les lignes des blocs et des sauts explicites', () => {
    expect(htmlToText('<p>Un</p><p>Deux</p>')).toBe('Un\nDeux');
    expect(htmlToText('Un<br>Deux')).toBe('Un\nDeux');
  });

  it('marque les listes d’un tiret', () => {
    expect(htmlToText('<ul><li>Un</li><li>Deux</li></ul>')).toBe('- Un\n- Deux');
  });

  it('sépare les cellules d’un tableau plutôt que de les coller', () => {
    // Sans séparateur, « SH010 » et « comp » deviendraient « SH010comp ».
    expect(htmlToText('<tr><td>SH010</td><td>comp</td></tr>')).toContain('SH010');
    expect(htmlToText('<tr><td>SH010</td><td>comp</td></tr>')).not.toContain('SH010comp');
  });

  it('décode les entités que nos gabarits produisent', () => {
    expect(htmlToText('<p>Version &laquo; v003 &raquo; &mdash; 30&nbsp;%</p>')).toBe(
      'Version « v003 » — 30 %',
    );
    expect(htmlToText('<p>Rock &amp; Roll &lt;3</p>')).toBe('Rock & Roll <3');
  });

  it('jette ce qui n’a pas de texte lisible, contenu compris', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Visible</p>')).toBe('Visible');
    expect(htmlToText('<script>alert(1)</script><p>Visible</p>')).toBe('Visible');
  });

  it('n’empile pas les lignes vides', () => {
    expect(htmlToText('<p>Un</p><div></div><div></div><p>Deux</p>')).toBe('Un\nDeux');
  });

  it('rend une chaîne vide pour un HTML sans texte', () => {
    expect(htmlToText('<div><img src="x" /></div>')).toBe('');
  });
});

describe('preheader', () => {
  it('reste invisible : hauteur nulle, opacité nulle, masqué pour Outlook', () => {
    const html = preheader('Trois plans attendent votre review');
    expect(html).toContain('max-height:0');
    expect(html).toContain('opacity:0');
    expect(html).toContain('mso-hide:all');
  });

  it('porte le texte d’aperçu', () => {
    expect(preheader('Trois plans')).toContain('Trois plans');
  });

  it('échappe le HTML : un nom de projet n’ouvre pas de balise', () => {
    expect(preheader('<script>alert(1)</script>')).not.toContain('<script>');
    expect(preheader('Rock & Roll')).toContain('Rock &amp; Roll');
  });

  it('pousse hors du champ le texte qui suivrait', () => {
    // Sans ce rembourrage, le client complète l'aperçu avec le début du corps —
    // chez nous le nom du studio, identique d'un message à l'autre.
    expect(preheader('Court').length).toBeGreaterThan(500);
  });
});
