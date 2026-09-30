// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useHomeViewShortcut } from './useHomeViewShortcut';

afterEach(cleanup);

/** Frappe une touche sur une cible donnée (par défaut le document). */
function press(key: string, target: EventTarget = document, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/**
 * `H` est la seule commande d'un invité sur un viewer spatial : il faut qu'elle marche sans
 * bouton, et qu'elle ne se déclenche pas pendant qu'il tape « chaise » dans son commentaire.
 */
describe('useHomeViewShortcut', () => {
  it('ramène à la vue d’origine', () => {
    const home = vi.fn();
    renderHook(() => useHomeViewShortcut(home, true));
    press('h');
    expect(home).toHaveBeenCalledTimes(1);
  });

  it('reste inerte tant que la scène n’est pas prête', () => {
    const home = vi.fn();
    renderHook(() => useHomeViewShortcut(home, false));
    press('H');
    expect(home).not.toHaveBeenCalled();
  });

  it('ne recadre pas pendant la saisie d’un commentaire', () => {
    const home = vi.fn();
    renderHook(() => useHomeViewShortcut(home, true));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    press('h', textarea);
    expect(home).not.toHaveBeenCalled();
    textarea.remove();
  });

  it('laisse passer les raccourcis du navigateur (Ctrl+H, Cmd+H)', () => {
    const home = vi.fn();
    renderHook(() => useHomeViewShortcut(home, true));
    press('h', document, { ctrlKey: true });
    press('h', document, { metaKey: true });
    expect(home).not.toHaveBeenCalled();
  });

  it('se débranche au démontage — plus rien ne réagit', () => {
    const home = vi.fn();
    const { unmount } = renderHook(() => useHomeViewShortcut(home, true));
    unmount();
    press('h');
    expect(home).not.toHaveBeenCalled();
  });
});
