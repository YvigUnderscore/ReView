// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EntityCard, { type EntityCardProps } from '../EntityCard';

/**
 * La lueur « non consulté » (Phase 50, lot 9).
 *
 * Ce que ces tests verrouillent n'est pas l'apparence mais la **hiérarchie** : la couleur
 * de la lueur (`info`) ne doit jamais se confondre avec celle de la sélection (`primary`),
 * et la sélection doit gagner. Une carte cochée qui se lirait comme « du nouveau » ferait
 * croire à un état qu'on n'a pas choisi, et pire, une carte allumée qui se lirait comme
 * cochée exposerait à une action de masse sur ce qu'on croyait désélectionné.
 */
const markup = (props: Partial<EntityCardProps> = {}) =>
  renderToStaticMarkup(<EntityCard title="SH010" view="cards" {...props} />);

describe('EntityCard — lueur « non consulté »', () => {
  it('éteinte par défaut : la bordure reste celle de toutes les cartes', () => {
    const html = markup({ meta: { updatedAt: '2026-02-01T00:00:00.000Z' } });
    expect(html).toContain('border-border');
    expect(html).not.toContain('border-info');
  });

  it('allumée, la carte prend le token `info` — jamais `primary`', () => {
    const html = markup({ meta: { unseen: true, updatedAt: '2026-02-01T00:00:00.000Z' } });
    expect(html).toContain('border-info');
    expect(html).toContain('ring-info/40');
    // L'espace en tête est ce qui distingue la bordure de repos de la variante de survol :
    // toute carte porte `hover:border-primary`, et c'est très bien — le survol est un
    // retour transitoire, pas un état de l'entité.
    expect(html).not.toContain(' border-primary');
  });

  it('la sélection l’emporte : une carte cochée se lit comme cochée', () => {
    const html = markup({
      meta: { unseen: true },
      selection: { selected: true, onSelect: () => {} },
    });
    expect(html).toContain('border-primary');
    expect(html).not.toContain('border-info');
  });

  it('en vue compacte aussi — la ligne est la carte', () => {
    const html = markup({ view: 'compact', meta: { unseen: true } });
    expect(html).toContain('border-info');
  });

  it('la bande s’affiche pour le seul « non consulté », sur une carte par ailleurs vide', () => {
    // Sans cela, une entité neuve — ni assigné, ni étape, ni date — n'aurait eu aucun
    // endroit où poser son point : `EntityCardMeta` se taisait faute de contenu.
    const bare = markup({ meta: {} });
    const lit = markup({ meta: { unseen: true } });
    expect(bare).not.toContain('bg-info');
    expect(lit).toContain('bg-info');
  });
});
