// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { STUB_LINE_HEIGHT, stubLayoutMetrics } from './layoutMetrics';

/**
 * Five test files rely on this double to check a MEASURED clamp: if it
 * lied, they would be checking its lie. So we verify that it does return what it announces
 * and that it leaves the document as it found it.
 */

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

const div = (className: string, text: string): HTMLDivElement => {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
};

describe('stubLayoutMetrics', () => {
  it('counts the lines at the requested width', () => {
    restore = stubLayoutMetrics({ charsPerLine: 20 });
    expect(div('', 'x'.repeat(20)).scrollHeight).toBe(STUB_LINE_HEIGHT);
    expect(div('', 'x'.repeat(21)).scrollHeight).toBe(2 * STUB_LINE_HEIGHT);
    expect(div('', 'a\nb\nc').scrollHeight).toBe(3 * STUB_LINE_HEIGHT);
  });

  it('caps the visible height only on a clamped element', () => {
    restore = stubLayoutMetrics({ charsPerLine: 20 });
    const wall = 'x'.repeat(200);
    expect(div('', wall).clientHeight).toBe(10 * STUB_LINE_HEIGHT);
    expect(div('line-clamp-3', wall).clientHeight).toBe(3 * STUB_LINE_HEIGHT);
    expect(div('max-h-32 overflow-hidden', wall).clientHeight).toBe(128);
  });

  it('does not cap below the content: a short text never overflows', () => {
    restore = stubLayoutMetrics({ charsPerLine: 20 });
    const short = div('line-clamp-3', 'la soudure');
    expect(short.clientHeight).toBe(short.scrollHeight);
  });

  it('the same remark overflows at 22 characters per line and fits at 40', () => {
    const note = 'x'.repeat(90);
    restore = stubLayoutMetrics({ charsPerLine: 22 });
    const narrow = div('line-clamp-3', note);
    expect(narrow.scrollHeight).toBeGreaterThan(narrow.clientHeight);
    restore();
    restore = stubLayoutMetrics({ charsPerLine: 40 });
    const wide = div('line-clamp-3', note);
    expect(wide.scrollHeight).toBe(wide.clientHeight);
  });

  it('leaves the document intact', () => {
    const before = document.createElement('div').scrollHeight;
    restore = stubLayoutMetrics({ charsPerLine: 20 });
    restore();
    restore = null;
    expect(document.createElement('div').scrollHeight).toBe(before);
  });
});
