// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ListSentinel, { ListCount } from './ListSentinel';

/**
 * Ce que la liste doit dire d'elle-même : combien de lignes sur combien, et qu'il en
 * reste. C'est exactement ce qui manquait — cent plans sur douze cents, sans un mot.
 *
 * Les assertions portent sur la branche choisie, jamais sur le texte traduit : le
 * catalogue peut changer de formulation sans invalider le comportement vérifié ici.
 */
describe('ListCount', () => {
  it('n’affiche pas le libellé de liste complète tant qu’elle est tronquée', () => {
    const html = renderToStaticMarkup(<ListCount loaded={100} total={1247} label="1,247 media" />);
    expect(html).not.toContain('1,247 media');
    expect(html).toContain('<p');
  });

  it('rend le libellé complet une fois tout chargé', () => {
    expect(renderToStaticMarkup(<ListCount loaded={12} total={12} label="12 media" />)).toContain('12 media');
  });

  it('garde un compteur quand aucun libellé complet n’est fourni', () => {
    expect(renderToStaticMarkup(<ListCount loaded={12} total={12} />)).toContain('<p');
  });

  it('ne dit rien sur une liste vide — l’état vide s’en charge', () => {
    expect(renderToStaticMarkup(<ListCount loaded={0} total={0} />)).toBe('');
  });
});

describe('ListSentinel', () => {
  it('n’occupe aucune place quand la liste est complète', () => {
    const html = renderToStaticMarkup(
      <ListSentinel hasMore={false} isLoading={false} onLoadMore={() => {}} />,
    );
    expect(html).toBe('');
  });

  it('offre une commande explicite tant qu’il reste des pages', () => {
    const html = renderToStaticMarkup(<ListSentinel hasMore isLoading={false} onLoadMore={() => {}} />);
    expect(html).toContain('<button');
    expect(html).not.toContain('disabled=""');
  });

  it('verrouille la commande pendant le chargement — deux clics, une seule page', () => {
    const html = renderToStaticMarkup(<ListSentinel hasMore isLoading onLoadMore={() => {}} />);
    expect(html).toContain('disabled=""');
  });
});
