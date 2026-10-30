// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import CompareAB from './CompareAB';
import type { CompareTarget } from './useCompareTargets';

/**
 * The two settings of the image comparison.
 *
 * B used to be chosen in a header menu that disappeared at the wrong moment, and the
 * "Compare" tab of the dock offered no choice. What is checked here: both sides are visible,
 * and B reaches down to the media. A version carrying two images could only be compared
 * through the first one.
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
  // A version with no media of the same type is not offered: there would be nothing to compare.
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
  it('shows both sides: A is the open media, B a selector', () => {
    const { container, select } = setup();
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('bunny_beauty_v001.exr');
    expect(container.textContent).toContain('B');
    expect(select).toBeTruthy();
  });

  it('lists B by version then by media, and skips versions with nothing to compare', () => {
    const { select } = setup();
    const groups = [...select.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['v002']);
    expect([...select.querySelectorAll('optgroup option')].map((o) => o.textContent)).toEqual([
      'bunny_beauty.exr',
      'bunny_layout.exr',
    ]);
  });

  it('picks the ticked media, including the second one of the same version', () => {
    const { select, onSetB } = setup();
    fireEvent.change(select, { target: { value: '21' } });
    expect(onSetB).toHaveBeenCalledWith(21);
  });

  it('closes the comparison with a button, not with a switch hard-wired on', () => {
    const { getByTitle, onClear, container } = setup({ bId: 20 });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    fireEvent.click(getByTitle('Close the comparison'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('going back to "no comparison" closes it', () => {
    const { select, onClear } = setup({ bId: 20 });
    expect(select.value).toBe('20');
    fireEvent.change(select, { target: { value: '' } });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("keeps the chosen B displayed until the neighbours' media have arrived", () => {
    // Without a fallback option, the field dropped back to "no comparison" while a
    // comparison was in progress.
    const { select } = setup({ bId: 99, targets: [] });
    expect(select.value).toBe('99');
  });
});
