// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewShortcuts, type ViewCommands } from './useViewShortcuts';
import { viewActionsFor } from '../chrome/tools';

/**
 * `F` et `H` sur les viewers plats. Les deux actions de vue étaient **déclarées** par le rail
 * (`action.fitMedia`, `action.resetMedia`) et branchées nulle part : les deux lettres ne
 * faisaient rien, ni sur une image, ni sur une vidéo.
 */
const mount = (commands: ViewCommands | null) => renderHook(() => useViewShortcuts(commands));

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

const spies = () => ({ fit: vi.fn<() => void>(), oneToOne: vi.fn<() => void>() }) satisfies ViewCommands;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useViewShortcuts', () => {
  it('reprend exactement les touches que le rail annonce', () => {
    expect(viewActionsFor('VIDEO').map((a) => a.key)).toEqual(['F', 'H']);
    expect(viewActionsFor('IMAGE').map((a) => a.key)).toEqual(['F', 'H']);
  });

  it('F ajuste à l’écran', () => {
    const cmd = spies();
    mount(cmd);
    press('f');
    expect(cmd.fit).toHaveBeenCalledTimes(1);
    expect(cmd.oneToOne).not.toHaveBeenCalled();
  });

  it('H revient à la taille réelle', () => {
    const cmd = spies();
    mount(cmd);
    press('h');
    expect(cmd.oneToOne).toHaveBeenCalledTimes(1);
  });

  it('ignore la frappe modifiée — Ctrl+F reste la recherche du navigateur', () => {
    const cmd = spies();
    mount(cmd);
    press('f', { ctrlKey: true });
    press('h', { shiftKey: true });
    expect(cmd.fit).not.toHaveBeenCalled();
    expect(cmd.oneToOne).not.toHaveBeenCalled();
  });

  it('désarmé (`null`), ne répond à rien — les panes de comparaison ne doublent pas le geste', () => {
    const cmd = spies();
    mount(null);
    press('f');
    expect(cmd.fit).not.toHaveBeenCalled();
  });
});
