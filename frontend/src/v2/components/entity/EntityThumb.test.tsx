// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EntityThumb from './EntityThumb';

/**
 * Le repli en nom est la règle d'affichage de tous les éléments (projet, séquence, plan,
 * asset) : ce qui est vérifié ici, c'est qu'il ne prend jamais le pas sur une vraie
 * miniature, et qu'il ne double pas le titre pour un lecteur d'écran.
 */
describe('EntityThumb', () => {
  it('affiche le nom tant qu’aucune image n’existe', () => {
    const html = renderToStaticMarkup(<EntityThumb name="SH0120" />);
    expect(html).toContain('SH0120');
    expect(html).not.toContain('<img');
  });

  it('cède la place à la miniature dès qu’une image parvient', () => {
    const html = renderToStaticMarkup(<EntityThumb name="SH0120" url="https://minio/t.jpg" />);
    expect(html).toContain('src="https://minio/t.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    // Le nom n'a plus à être écrit : l'image le remplace, et le titre le porte déjà.
    expect(html).not.toContain('SH0120');
  });

  it('ne redit pas le nom au lecteur d’écran — le titre le porte déjà', () => {
    expect(renderToStaticMarkup(<EntityThumb name="SH0120" />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<EntityThumb name="SH0120" url="https://minio/t.jpg" />)).toContain('alt=""');
  });

  it('abrège sous 40 px, où le nom entier ne tiendrait pas', () => {
    expect(renderToStaticMarkup(<EntityThumb name="Le Grand Voyage" variant="mini" />)).toContain('LG');
  });

  it('réduit la police à mesure que le nom s’allonge', () => {
    expect(renderToStaticMarkup(<EntityThumb name="SQ010" />)).toContain('text-xl');
    expect(renderToStaticMarkup(<EntityThumb name="Le Grand Voyage de Mémé" />)).toContain('text-sm');
  });
});
