// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { shouldBlockNativeMenu, situationOf, NATIVE_ZONES } from './contextTarget';

const situation = (over: Partial<Parameters<typeof shouldBlockNativeMenu>[0]> = {}) => ({
  defaultPrevented: false,
  shiftKey: false,
  inNativeZone: false,
  ...over,
});

describe('shouldBlockNativeMenu', () => {
  it('blocks the native menu in the usual case', () => {
    expect(shouldBlockNativeMenu(situation())).toBe(true);
  });

  it('hands control to the component that has already served its menu', () => {
    expect(shouldBlockNativeMenu(situation({ defaultPrevented: true }))).toBe(false);
  });

  it('returns the native menu on Shift+right click', () => {
    expect(shouldBlockNativeMenu(situation({ shiftKey: true }))).toBe(false);
  });

  it('returns the native menu in a text input', () => {
    expect(shouldBlockNativeMenu(situation({ inNativeZone: true }))).toBe(false);
  });

  it('gives priority to the domain menu over all other exceptions', () => {
    expect(shouldBlockNativeMenu({ defaultPrevented: true, shiftKey: true, inNativeZone: true })).toBe(false);
  });
});

describe('situationOf', () => {
  it('detects a text input area from the target', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const event = { target: input, defaultPrevented: false, shiftKey: false } as unknown as MouseEvent;
    expect(situationOf(event).inNativeZone).toBe(true);
    input.remove();
  });

  it('detects a text input area from a descendant', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const span = document.createElement('span');
    editable.append(span);
    document.body.append(editable);
    const event = { target: span, defaultPrevented: false, shiftKey: false } as unknown as MouseEvent;
    expect(situationOf(event).inNativeZone).toBe(true);
    editable.remove();
  });

  it('reports nothing on an ordinary element', () => {
    const div = document.createElement('div');
    document.body.append(div);
    const event = { target: div, defaultPrevented: true, shiftKey: true } as unknown as MouseEvent;
    expect(situationOf(event)).toEqual({
      defaultPrevented: true,
      shiftKey: true,
      inNativeZone: false,
    });
    div.remove();
  });

  it('supports a target without closest (document, window)', () => {
    const event = { target: null, defaultPrevented: false, shiftKey: false } as unknown as MouseEvent;
    expect(situationOf(event).inNativeZone).toBe(false);
  });

  it('covers the four families of native areas', () => {
    expect(NATIVE_ZONES).toContain('input');
    expect(NATIVE_ZONES).toContain('textarea');
    expect(NATIVE_ZONES).toContain('select');
    expect(NATIVE_ZONES).toContain('contenteditable');
  });
});
