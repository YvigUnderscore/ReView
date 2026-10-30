// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyedValue } from './useKeyedValue';

describe('useKeyedValue', () => {
  it('keeps the first identity while the key is unchanged, takes the new value when it changes', () => {
    const { result, rerender } = renderHook(({ value, k }) => useKeyedValue(value, k), {
      initialProps: { value: { n: 1 }, k: 'a' },
    });
    const first = result.current;
    rerender({ value: { n: 2 }, k: 'a' });
    expect(result.current).toBe(first);
    const next = { n: 3 };
    rerender({ value: next, k: 'b' });
    expect(result.current).toBe(next);
    rerender({ value: { n: 4 }, k: 'b' });
    expect(result.current).toBe(next);
  });
});
