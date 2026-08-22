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
