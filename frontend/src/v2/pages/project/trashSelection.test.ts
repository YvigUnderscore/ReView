// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  countAll,
  countSelected,
  isSelected,
  selectedDomains,
  toggle,
  toggleDomain,
  toggleEverything,
  type TrashInventory,
} from './trashSelection';

/** Une corbeille de fin de projet : trois domaines, sept éléments. */
const INVENTORY: TrashInventory = {
  sequences: [1, 2],
  shots: [10, 11, 12],
  assets: [20, 21],
};

describe('toggle', () => {
  it('ajoute puis retire un élément', () => {
    const once = toggle({}, 'shots', 10);
    expect(isSelected(once, 'shots', 10)).toBe(true);
    expect(isSelected(toggle(once, 'shots', 10), 'shots', 10)).toBe(false);
  });

  it('ne touche pas les autres domaines', () => {
    const selection = toggle(toggle({}, 'shots', 10), 'assets', 20);
    expect(countSelected(selection)).toBe(2);
    expect(isSelected(selection, 'shots', 10)).toBe(true);
  });
});

describe('toggleDomain', () => {
  it('coche la section entière, puis la décoche', () => {
    const all = toggleDomain({}, 'shots', [10, 11, 12]);
    expect(countSelected(all)).toBe(3);
    expect(countSelected(toggleDomain(all, 'shots', [10, 11, 12]))).toBe(0);
  });

  it('complète une section à moitié cochée plutôt que de la vider', () => {
    const half = toggle({}, 'shots', 10);
    expect(countSelected(toggleDomain(half, 'shots', [10, 11, 12]))).toBe(3);
  });
});

describe('toggleEverything', () => {
  it('coche tous les domaines d’un coup — le geste que la corbeille n’avait pas', () => {
    const all = toggleEverything({}, INVENTORY);
    expect(countSelected(all)).toBe(7);
    expect(selectedDomains(all).sort()).toEqual(['assets', 'sequences', 'shots']);
  });

  it('décoche tout quand tout était coché', () => {
    const all = toggleEverything({}, INVENTORY);
    expect(countSelected(toggleEverything(all, INVENTORY))).toBe(0);
  });

  it('complète plutôt que de vider quand la sélection est partielle', () => {
    // C'est ce qu'on attend d'une case « tout sélectionner » à moitié cochée.
    const partial = toggle({}, 'shots', 10);
    expect(countSelected(toggleEverything(partial, INVENTORY))).toBe(7);
  });

  it('ne fait rien sur une corbeille vide', () => {
    expect(toggleEverything({}, {})).toEqual({});
  });
});

describe('selectedDomains', () => {
  it('ignore les domaines vidés — traiter un domaine sans élément serait un appel pour rien', () => {
    const selection = toggleDomain(toggle({}, 'shots', 10), 'shots', [10]);
    expect(selectedDomains(selection)).toEqual([]);
  });
});

describe('countAll', () => {
  it('compte tout ce que la corbeille contient', () => {
    expect(countAll(INVENTORY)).toBe(7);
    expect(countAll({})).toBe(0);
  });
});
