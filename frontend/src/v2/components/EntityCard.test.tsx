// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EntityCard, { type EntityCardProps } from './EntityCard';

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

  it('garde l’icône de repli quand aucune vignette n’est connue', () => {
    for (const view of ['cards', 'compact'] as const) {
      const html = markup({ view });
      expect(html).not.toContain('<img');
      expect(html).toContain('<svg');
    }
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
