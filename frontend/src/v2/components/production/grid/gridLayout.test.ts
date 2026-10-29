// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { COL_W_MAX, COL_W_MIN, HEAD_W, columnWidth, lineWidth } from './gridLayout';

/**
 * Column width, since the cell writes the name of its status.
 *
 * Two pitfalls to avoid, and these are what these cases lock down: a grid that keeps the earlier width cuts "In Progress"
 * in the middle, and a grid sized for the worst imaginable name forces on everyone a table one can no longer see on a screen.
 */
describe('columnWidth', () => {
  it('takes not one pixel more than before when the names are short', () => {
    // "Final", "Omitted", "ip": a ShotGrid reference fits within the earlier width.
    expect(columnWidth(0)).toBe(COL_W_MIN);
    expect(columnWidth('Final'.length)).toBe(COL_W_MIN);
  });

  it('widens for the local vocabulary, which every instance receives at migration', () => {
    const width = columnWidth('In Progress'.length);
    expect(width).toBeGreaterThan(COL_W_MIN);
    expect(width).toBeLessThanOrEqual(COL_W_MAX);
  });

  it('caps: an endless name is cut, it does not carry the whole table along', () => {
    expect(columnWidth('Pending Supervisor And Client Approval'.length)).toBe(COL_W_MAX);
    expect(columnWidth(500)).toBe(COL_W_MAX);
  });

  it('never shrinks when the name gets longer', () => {
    let previous = 0;
    for (let length = 0; length <= 40; length += 1) {
      const width = columnWidth(length);
      expect(width).toBeGreaterThanOrEqual(previous);
      previous = width;
    }
  });
});

describe('lineWidth', () => {
  it('adds the head column and the department columns together', () => {
    expect(lineWidth(0, 100)).toBe(HEAD_W);
    expect(lineWidth(12, 100)).toBe(HEAD_W + 1200);
  });
});
