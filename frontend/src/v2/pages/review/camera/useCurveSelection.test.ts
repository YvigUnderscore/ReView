// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAnim, upsertKey, type CameraAnimV2, type KeyRef } from './channels/model';
import { useCurveSelection } from './useCurveSelection';

const both: KeyRef[] = [
  { channel: 'px', index: 0 },
  { channel: 'px', index: 1 },
];

/** Monte le hook avec l'animation et la tête de lecture que `useCameraAnim` lui prêterait. */
function setup(timeMs = 0) {
  const animRef = { current: upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 500, 50) };
  const timeRef = { current: timeMs };
  const commit = vi.fn((next: CameraAnimV2) => {
    animRef.current = next;
  });
  const { result } = renderHook(() => useCurveSelection({ animRef, timeRef, commit }));
  return { result, animRef, commit };
}

const times = (anim: CameraAnimV2) => (anim.channels.px?.keys ?? []).map((k) => k.t);
const modes = (anim: CameraAnimV2) => (anim.channels.px?.keys ?? []).map((k) => k.mode);

beforeEach(() => {
  localStorage.clear();
});

describe('useCurveSelection — sélection', () => {
  it('mémorise la sélection et la vide sur demande', () => {
    const { result } = setup();
    expect(result.current.selection).toEqual([]);
    act(() => result.current.setSelection(both));
    expect(result.current.selection).toEqual(both);
    act(() => result.current.clearSelection());
    expect(result.current.selection).toEqual([]);
  });

  it('applique un mode de tangente à toutes les clés sélectionnées', () => {
    const { result, commit, animRef } = setup();
    act(() => result.current.setSelection(both));
    act(() => result.current.setSelectionMode('linear'));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(modes(animRef.current)).toEqual(['linear', 'linear']);
  });

  it('supprime les clés sélectionnées et rend la sélection vide', () => {
    const { result, commit, animRef } = setup();
    act(() => result.current.setSelection([{ channel: 'px', index: 0 }]));
    act(() => result.current.removeSelection());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(times(animRef.current)).toEqual([500]);
    expect(result.current.selection).toEqual([]);
  });

  it('sans sélection, mode et suppression ne touchent pas à l’animation', () => {
    const { result, commit } = setup();
    act(() => result.current.setSelectionMode('step'));
    act(() => result.current.removeSelection());
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('useCurveSelection — presse-papier', () => {
  it('rien à coller sur un presse-papier vide', () => {
    const { result, commit } = setup();
    act(() => result.current.paste());
    expect(result.current.canPaste).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it('copie puis colle à la tête de lecture, et sélectionne les clés collées', () => {
    const { result, commit, animRef } = setup(200);
    act(() => result.current.setSelection(both));
    act(() => result.current.copySelection());
    expect(result.current.canPaste).toBe(true);
    act(() => result.current.paste());
    expect(commit).toHaveBeenCalledTimes(1);
    // Temps rebasés sur le plus tôt de la copie (0 et 500) puis reposés depuis 200 ms.
    expect(times(animRef.current)).toEqual([0, 200, 500, 700]);
    expect(result.current.selection).toEqual([
      { channel: 'px', index: 1 },
      { channel: 'px', index: 3 },
    ]);
  });

  it('copier sans sélection ne rend rien collable', () => {
    const { result } = setup();
    act(() => result.current.copySelection());
    expect(result.current.canPaste).toBe(false);
  });

  it('le presse-papier survit au démontage : un autre média peut coller', () => {
    const first = setup();
    act(() => first.result.current.setSelection([{ channel: 'px', index: 1 }]));
    act(() => first.result.current.copySelection());

    const second = setup(1000);
    expect(second.result.current.canPaste).toBe(true);
    act(() => second.result.current.paste());
    expect(times(second.animRef.current)).toEqual([0, 500, 1000]);
  });
});
