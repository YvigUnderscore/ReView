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

/** An end-of-project trash: three domains, seven items. */
const INVENTORY: TrashInventory = {
  sequences: [1, 2],
  shots: [10, 11, 12],
  assets: [20, 21],
};

describe('toggle', () => {
  it('adds then removes an item', () => {
    const once = toggle({}, 'shots', 10);
    expect(isSelected(once, 'shots', 10)).toBe(true);
    expect(isSelected(toggle(once, 'shots', 10), 'shots', 10)).toBe(false);
  });

  it('does not touch the other domains', () => {
    const selection = toggle(toggle({}, 'shots', 10), 'assets', 20);
    expect(countSelected(selection)).toBe(2);
    expect(isSelected(selection, 'shots', 10)).toBe(true);
  });
});

describe('toggleDomain', () => {
  it('ticks the whole section, then unticks it', () => {
    const all = toggleDomain({}, 'shots', [10, 11, 12]);
    expect(countSelected(all)).toBe(3);
    expect(countSelected(toggleDomain(all, 'shots', [10, 11, 12]))).toBe(0);
  });

  it('completes a half-ticked section rather than emptying it', () => {
    const half = toggle({}, 'shots', 10);
    expect(countSelected(toggleDomain(half, 'shots', [10, 11, 12]))).toBe(3);
  });
});

describe('toggleEverything', () => {
  it('ticks all domains at once: the gesture the trash did not have', () => {
    const all = toggleEverything({}, INVENTORY);
    expect(countSelected(all)).toBe(7);
    expect(selectedDomains(all).sort()).toEqual(['assets', 'sequences', 'shots']);
  });

  it('unticks everything when everything was ticked', () => {
    const all = toggleEverything({}, INVENTORY);
    expect(countSelected(toggleEverything(all, INVENTORY))).toBe(0);
  });

  it('completes rather than empties when the selection is partial', () => {
    // This is what one expects from a half-ticked "select all" checkbox.
    const partial = toggle({}, 'shots', 10);
    expect(countSelected(toggleEverything(partial, INVENTORY))).toBe(7);
  });

  it('does nothing on an empty trash', () => {
    expect(toggleEverything({}, {})).toEqual({});
  });
});

describe('selectedDomains', () => {
  it('ignores emptied domains: processing a domain with no item would be a pointless call', () => {
    const selection = toggleDomain(toggle({}, 'shots', 10), 'shots', [10]);
    expect(selectedDomains(selection)).toEqual([]);
  });
});

describe('countAll', () => {
  it('counts everything the trash contains', () => {
    expect(countAll(INVENTORY)).toBe(7);
    expect(countAll({})).toBe(0);
  });
});
