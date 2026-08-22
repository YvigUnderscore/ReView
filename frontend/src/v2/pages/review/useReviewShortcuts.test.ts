// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompareOffset } from './compareOffset';
import { useReviewShortcuts } from './useReviewShortcuts';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

/** Lecteur minimal : le hook n'appelle que `pause`, `play` et lit `paused`. */
const fakeVideo = () =>
  ({
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    readyState: 4,
  }) as unknown as HTMLVideoElement;

const mount = (video: HTMLVideoElement, onMarker = vi.fn(), fps = 24) => {
  const ref = createRef<HTMLVideoElement>();
  (ref as { current: unknown }).current = video;
  const view = renderHook(() => useReviewShortcuts({ videoRef: ref, fps, onMarker }));
  return { ...view, onMarker };
};

const press = (init: KeyboardEventInit) =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });

beforeEach(() => useCompareOffset.getState().reset());
afterEach(() => {
  // `globals` n'est pas activé dans la config vitest : le démontage n'est pas automatique,
  // et les écouteurs clavier d'un test survivraient au suivant.
  cleanup();
  vi.clearAllMocks();
});

describe('touche M — le transport tranche contre le rail d’outils', () => {
  it('met en pause et ouvre le composer à la frame courante', () => {
    const video = fakeVideo();
    const { onMarker } = mount(video);
    press({ key: 'm' });
    expect(video.pause).toHaveBeenCalled();
    expect(onMarker).toHaveBeenCalledTimes(1);
  });

  it('n’atteint plus le rail : la frappe ne bascule pas en mode Annoter', () => {
    // Le rail écoute sur `window` ; ce hook, sur `document`. La remontée traverse le second
    // en premier, et s'y arrête — c'est ce qui règle la collision avec l'outil `shape-move`.
    const railHeard: string[] = [];
    const rail = (e: KeyboardEvent) => railHeard.push(e.key);
    window.addEventListener('keydown', rail);
    const video = fakeVideo();
    mount(video);
    press({ key: 'm' });
    expect(railHeard).toEqual([]);
    // Les autres lettres continuent d'arriver au rail : seul M lui est retiré.
    press({ key: 'd' });
    expect(railHeard).toEqual(['d']);
    window.removeEventListener('keydown', rail);
  });
});

describe('crochets — décalage de la comparaison A/B', () => {
  it('décale d’une frame à chaque frappe, dans les deux sens', () => {
    mount(fakeVideo());
    press({ code: 'BracketRight', key: ']' });
    expect(useCompareOffset.getState().frames).toBe(1);
    press({ code: 'BracketRight', key: ']' });
    expect(useCompareOffset.getState().frames).toBe(2);
    press({ code: 'BracketLeft', key: '[' });
    expect(useCompareOffset.getState().frames).toBe(1);
  });

  it('convertit en secondes à la cadence du média', () => {
    mount(fakeVideo(), vi.fn(), 25);
    press({ code: 'BracketRight', key: ']' });
    expect(useCompareOffset.getState().seconds).toBeCloseTo(0.04, 6);
  });

  it('avance de dix frames avec Maj, et se recale à zéro avec Maj+\\', () => {
    mount(fakeVideo());
    press({ code: 'BracketRight', key: '}', shiftKey: true });
    expect(useCompareOffset.getState().frames).toBe(10);
    press({ code: 'Backslash', key: '|', shiftKey: true });
    expect(useCompareOffset.getState().frames).toBe(0);
  });

  it('répond à la position de la touche, même quand le clavier produit autre chose', () => {
    // Clavier AZERTY : la position « BracketRight » porte le caractère « $ ».
    mount(fakeVideo());
    press({ code: 'BracketRight', key: '$' });
    expect(useCompareOffset.getState().frames).toBe(1);
  });

  it('oublie le décalage en quittant le média : le conform suivant repart aligné', () => {
    const view = mount(fakeVideo());
    press({ code: 'BracketRight', key: ']' });
    expect(useCompareOffset.getState().frames).toBe(1);
    view.unmount();
    expect(useCompareOffset.getState().frames).toBe(0);
  });

  it('reste inerte dans un champ de saisie', () => {
    mount(fakeVideo());
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'BracketRight' }),
      );
    });
    expect(useCompareOffset.getState().frames).toBe(0);
    input.remove();
  });
});
