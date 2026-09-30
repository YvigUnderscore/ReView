// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import EntityCard, { EntityContainer, type EntityCardProps } from './EntityCard';

/**
 * `EntityCard` est la carte de toutes les listes denses (plans, assets, projets). Cent
 * plans, c'était cent JPEG de 640 px demandés en parallèle dès le montage pour une
 * douzaine de cartes visibles. Le chargement paresseux est donc un attribut à ne pas
 * perdre au fil des refontes — et il ne doit rien changer à ce que la carte affiche.
 */
const markup = (props: Partial<EntityCardProps> = {}) =>
  renderToStaticMarkup(<EntityCard title="SH010" view="cards" {...props} />);

describe('EntityCard — vignette', () => {
  it('charge l’image de la vue cartes paresseusement et la décode hors du fil principal', () => {
    const html = markup({ thumbnailUrl: 'https://minio/thumb.jpg' });
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('src="https://minio/thumb.jpg"');
  });

  it('en fait autant en vue compacte', () => {
    const html = markup({ view: 'compact', thumbnailUrl: 'https://minio/thumb.jpg' });
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it('met le nom à la place de l’image tant qu’aucune vignette n’est connue', () => {
    // Une icône d'image grise répétée cent fois ne distinguait rien : sur une grille de
    // plans neufs, seul le nom dit ce qu'on regarde.
    const cards = markup();
    expect(cards).not.toContain('<img');
    // Deux fois : dans la tuile et dans le titre — la tuile est masquée au lecteur d'écran.
    expect(cards.match(/SH010/g)).toHaveLength(2);
    expect(cards).toContain('aria-hidden="true"');

    // Vue compacte : 32 px de côté, où seul l'abrégé tient.
    const compact = markup({ view: 'compact' });
    expect(compact).not.toContain('<img');
    expect(compact).toContain('>010<');
  });

  it('affiche toujours titre, sous-titre et badge', () => {
    const html = markup({
      subtitle: 'seq_010',
      badge: <span>WIP</span>,
      thumbnailUrl: 'https://minio/thumb.jpg',
    });
    expect(html).toContain('SH010');
    expect(html).toContain('seq_010');
    expect(html).toContain('WIP');
  });

  it('rend une image vide de texte alternatif : le titre porte déjà l’information', () => {
    // `alt=""` est délibéré (image décorative doublée par le titre) : le vérifier évite
    // qu'une future refonte ne la transforme en doublon lu par le lecteur d'écran.
    expect(markup({ thumbnailUrl: 'https://minio/thumb.jpg' })).toContain('alt=""');
  });
});

/**
 * La bande d'informations : ce qu'une carte dit d'une entité au-delà de son nom.
 *
 * Elle a été ajoutée pour répondre en un coup d'œil aux quatre questions qu'on se pose en
 * balayant une grille de deux cents plans. Deux invariants la tiennent : elle ne s'affiche
 * que si elle a quelque chose à dire, et elle dit la même chose dans les deux vues.
 */
describe('EntityCard — bande d’informations', () => {
  const alice = {
    id: 2,
    name: 'Alice Martin',
    firstName: 'Alice',
    lastName: 'Martin',
    username: null,
    avatarUrl: null,
  };

  it('montre la description, les visages et la pastille d’attente', () => {
    const html = markup({
      meta: { description: 'Le héros entre par la gauche', assignees: [alice], awaitingReview: 3 },
    });
    expect(html).toContain('Le héros entre par la gauche');
    // Pas d'avatar déposé : la pastille à initiales tient lieu de visage.
    expect(html).toContain('AM');
    expect(html).toContain('>3<');
  });

  it('ne réserve aucune hauteur quand il n’y a rien à dire', () => {
    // Une bande vide sur une carte neuve coûterait la densité de la grille entière.
    const withMeta = markup({ meta: {} });
    const without = markup({});
    expect(withMeta).toBe(without);
  });

  it('tait la pastille d’attente à zéro — « rien à regarder » n’est pas une information', () => {
    expect(markup({ meta: { awaitingReview: 0, assignees: [alice] } })).not.toContain('>0<');
  });

  it('dit la même chose en vue compacte', () => {
    const html = markup({ view: 'compact', meta: { description: 'Brief du plan', assignees: [alice] } });
    expect(html).toContain('Brief du plan');
    expect(html).toContain('AM');
  });

  it('borne la description à deux lignes en vue cartes, une seule en compact', () => {
    expect(markup({ meta: { description: 'x' } })).toContain('line-clamp-2');
    expect(markup({ view: 'compact', meta: { description: 'x' } })).toContain('truncate');
  });
});

/**
 * La grille et ses enveloppes d'apparition.
 *
 * Les enveloppes étaient keyées par **index** : filtrer une grille de plans réassociait
 * chaque carte à l'enveloppe de sa voisine — React réutilisait le nœud d'à-côté et
 * rejouait le fondu-montée sur des cartes déjà à l'écran (la liste « clignotait »). La
 * grandeur mesurée ici est donc un **nombre de cartes réassociées à un autre nœud** :
 * une avant le correctif, zéro après.
 */
describe('EntityContainer — apparition en cascade', () => {
  const grid = (codes: string[]) => (
    <EntityContainer view="cards">
      {codes.map((code) => (
        <EntityCard key={code} view="cards" title={code} thumbnailUrl="https://minio/t.jpg" />
      ))}
    </EntityContainer>
  );

  /** Enveloppes de la grille, dans l'ordre du DOM. */
  const wrappers = (container: HTMLElement) => [...(container.firstElementChild?.children ?? [])];

  it('laisse à chaque carte son nœud quand la liste est filtrée', () => {
    const { container, rerender } = render(grid(['SH010', 'SH020', 'SH030']));
    expect(wrappers(container)).toHaveLength(3);
    const kept = screen.getByText('SH020');

    rerender(grid(['SH020', 'SH030']));

    expect(screen.getByText('SH020')).toBe(kept);
    expect(screen.queryByText('SH010')).not.toBeInTheDocument();
  });

  it('anime en CSS, en respectant « animations réduites » sans JS', () => {
    const { container } = render(grid(['SH010', 'SH020']));

    for (const wrapper of wrappers(container)) {
      expect(wrapper).toHaveClass('animate-in');
      expect(wrapper).toHaveClass('motion-reduce:animate-none');
      // Sans `fill-mode-backwards`, la carte serait visible pendant son délai puis
      // disparaîtrait d'un coup pour se remontrer : un clignotement, pas une apparition.
      expect(wrapper).toHaveClass('fill-mode-backwards');
    }
  });

  it('étale l’entrée, mais borne le retard : une page de cent cartes n’attend pas trois secondes', () => {
    const { container } = render(grid(Array.from({ length: 40 }, (_, i) => `SH${i}`)));
    const delays = wrappers(container).map((w) => (w as HTMLElement).style.animationDelay);

    expect(delays.slice(0, 3)).toEqual(['0ms', '30ms', '60ms']);
    expect(Math.max(...delays.map((d) => Number.parseInt(d, 10)))).toBeLessThanOrEqual(360);
  });

  it('empile sans enveloppe en vue compacte', () => {
    const { container } = render(
      <EntityContainer view="compact">
        <EntityCard view="compact" title="SH010" thumbnailUrl="https://minio/t.jpg" />
      </EntityContainer>,
    );
    expect(container.querySelector('.animate-in')).toBeNull();
  });
});
