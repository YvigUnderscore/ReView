// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { stubLayoutMetrics } from '../../../../test/layoutMetrics';
import { t } from '../../../i18n';
import PoiSceneCards from './PoiSceneCards';
import { announcePoiAnchors, POI_ANCHOR_ATTR } from './poiAnchor';
import type { PoiSceneCard } from './poiCards';

/**
 * Le commentaire relu doit se lire DANS la scène. Ce fichier vérifie ce que le calque fait des
 * pastilles du viewer : il s'y ancre, il ouvre la première carte d'office, et il n'en laisse
 * jamais deux ouvertes — c'est ce qui garde la vue lisible quand deux points sont voisins.
 */
const cards: PoiSceneCard[] = [
  {
    index: 0,
    text: 'la soudure se voit',
    images: [{ src: 'blob:soudure', alt: 'soudure.png' }],
    intro: 'revoir la passe de rendu',
    author: 'Lou',
  },
  { index: 1, text: 'le boulon dépasse', images: [] },
];

/** Conteneur du viewer et ses pastilles — ce que `three/objectHotspot` y pose à chaque point. */
function viewer(count: number) {
  const container = document.createElement('div');
  const anchors = Array.from({ length: count }, (_, i) => {
    const pastille = document.createElement('div');
    pastille.setAttribute(POI_ANCHOR_ATTR, String(i));
    container.appendChild(pastille);
    return pastille;
  });
  document.body.appendChild(container);
  return { container, anchors };
}

const openPill = (n: number) => screen.getByRole('button', { name: t('poi.card.open', { n }) });
const closeButton = (n: number) => screen.queryByRole('button', { name: t('poi.card.close', { n }) });

/**
 * La carte ancrée est la surface ÉTROITE : 15 rem, soit une vingtaine de caractères par ligne.
 * Le repliage s'y mesure, et happy-dom ne met rien en page — on lui prête donc cette largeur.
 */
let restore: (() => void) | null = null;

// Avant, et non après : le nettoyage de React Testing Library doit démonter l'arbre (portails et
// Lightbox comprises) tant que leurs nœuds sont encore là — vitest joue les `afterEach` à l'envers.
beforeEach(() => {
  document.body.replaceChildren();
  restore = stubLayoutMetrics({ charsPerLine: 22 });
});

afterEach(() => {
  restore?.();
  restore = null;
});

describe('PoiSceneCards — le commentaire se lit à son point', () => {
  it('s’ancre DANS la pastille de chaque point : la carte suit la projection sans se projeter', () => {
    const { container, anchors } = viewer(2);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    expect(anchors[0].textContent).toContain('revoir la passe de rendu');
    expect(anchors[1].textContent).toContain('le boulon dépasse');
  });

  it('ouvre la carte du premier point d’office — le commentaire se lit en arrivant', () => {
    const { container } = viewer(2);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    expect(closeButton(1)).toBeInTheDocument();
    expect(screen.getByText('Lou')).toBeInTheDocument();
    // Le second point reste une étiquette : il s'ouvre au clic.
    expect(openPill(2)).toBeInTheDocument();
  });

  it('n’en laisse jamais deux ouvertes : ouvrir la seconde replie la première', () => {
    const { container } = viewer(2);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    fireEvent.click(openPill(2));
    expect(closeButton(2)).toBeInTheDocument();
    expect(closeButton(1)).not.toBeInTheDocument();
    expect(openPill(1)).toBeInTheDocument();
  });

  it('se replie sur elle-même : la carte ouverte redevient une étiquette', () => {
    const { container } = viewer(1);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    fireEvent.click(closeButton(1)!);
    expect(openPill(1)).toBeInTheDocument();
  });

  it('ouvre une image en grand dans la Lightbox partagée', () => {
    const { container } = viewer(1);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    fireEvent.click(screen.getByRole('button', { name: t('comments.openAttachment') }));
    expect(screen.getByRole('dialog', { name: t('comments.imagePreview') })).toBeInTheDocument();
  });

  it('borne la carte ouverte : trois lignes, miniature à côté, le reste sur un clic', () => {
    const long = '/mnt/prod/seq010/sh0420/comp/v012/sh0420_comp_v012_beauty_linear_exr_sequence';
    const { container } = viewer(1);
    render(
      <PoiSceneCards
        containerRef={{ current: container }}
        cards={[{ index: 0, text: long, images: cards[0].images }]}
      />,
    );
    // La carte ne masque pas la scène : elle se coupe à trois lignes, et se déroule au clic.
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: t('comments.expandComment', { count: long.length }) }),
    );
    expect(container.querySelector('.line-clamp-3')).toBeNull();
    // La miniature vit dans la même rangée que le texte — à côté, pas dessous.
    const strip = screen.getByRole('img').closest('div');
    expect(strip?.parentElement?.firstElementChild?.textContent).toContain(long);
    expect(strip?.className).toContain('shrink-0');
  });

  it('attend sa pastille : un point que le viewer n’a pas encore projeté ne rend rien', () => {
    const { container } = viewer(0);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    expect(closeButton(1)).not.toBeInTheDocument();
    // La pastille arrive à la première image dessinée ; l'annonce du marqueur réveille le calque.
    const pastille = document.createElement('div');
    pastille.setAttribute(POI_ANCHOR_ATTR, '0');
    act(() => {
      container.appendChild(pastille);
      announcePoiAnchors(container);
    });
    expect(closeButton(1)).toBeInTheDocument();
  });

  it('sans viewer monté, le calque ne rend rien et ne jette pas', () => {
    expect(() => render(<PoiSceneCards containerRef={{ current: null }} cards={cards} />)).not.toThrow();
    expect(closeButton(1)).not.toBeInTheDocument();
  });
});
