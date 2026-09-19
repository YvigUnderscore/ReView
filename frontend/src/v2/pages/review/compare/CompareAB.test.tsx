// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import CompareAB from './CompareAB';
import type { CompareTarget } from './useCompareTargets';

/**
 * Les deux réglages de la comparaison image.
 *
 * Avant, B se choisissait dans un menu d'en-tête qui disparaissait au mauvais moment, et
 * l'onglet « Comparaison » du dock n'en offrait aucun choix. Ce qui est vérifié ici : les deux
 * côtés se voient, et B descend jusqu'au média — une version portant deux images ne pouvait
 * être comparée que par la première.
 */
const targets: CompareTarget[] = [
  {
    versionId: 2,
    name: 'v002',
    media: [
      { id: 20, name: 'bunny_beauty.exr' },
      { id: 21, name: 'bunny_layout.exr' },
    ],
  },
  // Une version sans média du même type ne se propose pas : on n'y comparerait rien.
  { versionId: 3, name: 'v003', media: [] },
];

const setup = (over: Partial<Parameters<typeof CompareAB>[0]> = {}) => {
  const onSetB = vi.fn();
  const onClear = vi.fn();
  const view = render(
    <CompareAB
      aName="bunny_beauty_v001.exr"
      bId={null}
      targets={targets}
      onSetB={onSetB}
      onClear={onClear}
      {...over}
    />,
  );
  return { ...view, onSetB, onClear, select: view.getByRole('combobox') as HTMLSelectElement };
};

describe('CompareAB', () => {
  it('montre les deux côtés : A est le média ouvert, B un sélecteur', () => {
    const { container, select } = setup();
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('bunny_beauty_v001.exr');
    expect(container.textContent).toContain('B');
    expect(select).toBeTruthy();
  });

  it('liste B par version puis par média, et saute les versions sans rien à comparer', () => {
    const { select } = setup();
    const groups = [...select.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['v002']);
    expect([...select.querySelectorAll('optgroup option')].map((o) => o.textContent)).toEqual([
      'bunny_beauty.exr',
      'bunny_layout.exr',
    ]);
  });

  it('choisit le média coché, y compris le second d’une même version', () => {
    const { select, onSetB } = setup();
    fireEvent.change(select, { target: { value: '21' } });
    expect(onSetB).toHaveBeenCalledWith(21);
  });

  it('ferme la comparaison par un bouton, pas par un interrupteur coché en dur', () => {
    const { getByTitle, onClear, container } = setup({ bId: 20 });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    fireEvent.click(getByTitle('Close the comparison'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('revenir à « aucune comparaison » la ferme', () => {
    const { select, onClear } = setup({ bId: 20 });
    expect(select.value).toBe('20');
    fireEvent.change(select, { target: { value: '' } });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('garde le B choisi affiché tant que les médias des voisins ne sont pas arrivés', () => {
    // Sans option de repli, le champ retombait sur « aucune comparaison » alors qu'une
    // comparaison était bien en cours.
    const { select } = setup({ bId: 99, targets: [] });
    expect(select.value).toBe('99');
  });
});
