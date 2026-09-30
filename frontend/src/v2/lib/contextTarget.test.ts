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
  it('bloque le menu natif dans le cas courant', () => {
    expect(shouldBlockNativeMenu(situation())).toBe(true);
  });

  it('laisse la main au composant qui a déjà servi son menu', () => {
    expect(shouldBlockNativeMenu(situation({ defaultPrevented: true }))).toBe(false);
  });

  it('rend le menu natif sur Shift+clic droit', () => {
    expect(shouldBlockNativeMenu(situation({ shiftKey: true }))).toBe(false);
  });

  it('rend le menu natif dans un champ de saisie', () => {
    expect(shouldBlockNativeMenu(situation({ inNativeZone: true }))).toBe(false);
  });

  it('donne la priorité au menu métier sur toutes les autres exceptions', () => {
    expect(shouldBlockNativeMenu({ defaultPrevented: true, shiftKey: true, inNativeZone: true })).toBe(false);
  });
});

describe('situationOf', () => {
  it('détecte une zone de saisie depuis la cible', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const event = { target: input, defaultPrevented: false, shiftKey: false } as unknown as MouseEvent;
    expect(situationOf(event).inNativeZone).toBe(true);
    input.remove();
  });

  it('détecte une zone de saisie depuis un descendant', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const span = document.createElement('span');
    editable.append(span);
    document.body.append(editable);
    const event = { target: span, defaultPrevented: false, shiftKey: false } as unknown as MouseEvent;
    expect(situationOf(event).inNativeZone).toBe(true);
    editable.remove();
  });

  it('ne signale rien sur un élément ordinaire', () => {
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

  it('supporte une cible sans closest (document, window)', () => {
    const event = { target: null, defaultPrevented: false, shiftKey: false } as unknown as MouseEvent;
    expect(situationOf(event).inNativeZone).toBe(false);
  });

  it('couvre les quatre familles de zones natives', () => {
    expect(NATIVE_ZONES).toContain('input');
    expect(NATIVE_ZONES).toContain('textarea');
    expect(NATIVE_ZONES).toContain('select');
    expect(NATIVE_ZONES).toContain('contenteditable');
  });
});
