// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEditable, useGlobalShortcuts } from './shortcuts';
import { resolveBindings } from './shortcutRegistry';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const input = (type: string) => {
  const el = document.createElement('input');
  el.type = type;
  return el;
};

describe('isEditable', () => {
  it('bloque les raccourcis dans les champs de saisie de texte', () => {
    expect(isEditable(input('text'))).toBe(true);
    expect(isEditable(input('password'))).toBe(true);
    expect(isEditable(input('number'))).toBe(true);
    expect(isEditable(document.createElement('textarea'))).toBe(true);
    expect(isEditable(document.createElement('select'))).toBe(true);
  });

  it('laisse passer les raccourcis depuis les contrôles non textuels (checkbox du HUD…)', () => {
    expect(isEditable(input('checkbox'))).toBe(false);
    expect(isEditable(input('radio'))).toBe(false);
    expect(isEditable(input('range'))).toBe(false);
    expect(isEditable(document.createElement('button'))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

/**
 * La collision du leader `g`, constatée dans le code puis fermée (Phase 50).
 *
 * Ce gestionnaire vit sur `document`, le rail d'outils de la review sur `window` : la remontée
 * traverse le premier avant le second. Une frappe faisait donc deux choses — `g` armait l'outil
 * polygone *et* amorçait la séquence, et la frappe suivante (`p`, `k`, `b`) quittait la page en
 * armant au passage un outil du rail. La séquence consomme désormais ses deux frappes.
 */
const mountGlobal = (projectId: number | null = 7) => {
  const onHelp = vi.fn();
  const heard: string[] = [];
  const rail = (e: KeyboardEvent) => heard.push(e.key);
  window.addEventListener('keydown', rail);
  const view = renderHook(() => useGlobalShortcuts({ projectId, onHelp, bindings: resolveBindings() }));
  return {
    onHelp,
    heard,
    dispose: () => {
      window.removeEventListener('keydown', rail);
      view.unmount();
    },
  };
};

const press = (key: string) =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useGlobalShortcuts — la séquence « g » consomme ses deux frappes', () => {
  it('le leader n’atteint pas le rail d’outils de la review', () => {
    const { heard, dispose } = mountGlobal();
    press('g');
    expect(heard).toEqual([]);
    dispose();
  });

  it('la seconde frappe navigue, et n’atteint pas le rail non plus', () => {
    const { heard, dispose } = mountGlobal();
    press('g');
    press('b');
    expect(navigate).toHaveBeenCalledWith('/projects/7/board');
    expect(heard).toEqual([]);
    dispose();
  });

  it('une séquence avortée reste consommée, sans naviguer', () => {
    const { heard, dispose } = mountGlobal();
    press('g');
    press('x');
    expect(navigate).not.toHaveBeenCalled();
    expect(heard).toEqual([]);
    dispose();
  });

  it('hors séquence, les touches du rail passent — seul « g » lui est retiré', () => {
    const { heard, dispose } = mountGlobal();
    press('d');
    press('t');
    expect(heard).toEqual(['d', 't']);
    dispose();
  });

  it('« ? » ouvre l’aide', () => {
    const { onHelp, dispose } = mountGlobal();
    press('?');
    expect(onHelp).toHaveBeenCalledTimes(1);
    dispose();
  });
});
