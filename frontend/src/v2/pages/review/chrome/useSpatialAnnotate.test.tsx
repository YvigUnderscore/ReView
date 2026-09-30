// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSpatialAnnotate } from './useSpatialAnnotate';
import { defaultChromeState, type ChromeState } from './chromeState';
import type { ModeId } from './modes';
import type { ToolId } from './tools';
import type { Annotations } from '../useAnnotations';

/**
 * Le pont « Annoter » ↔ rail des viewers spatiaux. Sans lui, cliquer « Annoter » sur une scène
 * n'armait que le calque de dessin 2D : le rail restait en exploration, et les outils
 * d'annotation de la scène n'apparaissaient nulle part. C'est la panne décrite par l'utilisateur.
 */
function mount(initial: { annotating: boolean; mode?: ModeId; tool?: ToolId }) {
  const update = vi.fn();
  const setAnnotating = vi.fn();
  const state: ChromeState = {
    ...defaultChromeState(),
    ...(initial.mode ? { mode: initial.mode } : {}),
    ...(initial.tool ? { tool: initial.tool } : {}),
  };
  const ann = { annotating: initial.annotating, setAnnotating } as unknown as Annotations;
  const view = renderHook(
    (props: { state: ChromeState; ann: Annotations }) =>
      useSpatialAnnotate({ state: props.state, update, ann: props.ann }),
    { initialProps: { state, ann } },
  );
  const rerender = (next: { annotating?: boolean; mode?: ModeId; tool?: ToolId }) =>
    view.rerender({
      state: {
        ...state,
        ...(next.mode ? { mode: next.mode } : {}),
        ...(next.tool ? { tool: next.tool } : {}),
      },
      ann: {
        annotating: next.annotating ?? initial.annotating,
        setAnnotating,
      } as unknown as Annotations,
    });
  return { update, setAnnotating, rerender };
}

describe('useSpatialAnnotate', () => {
  it('le bouton « Annoter » arme le mode du rail', () => {
    const { update, rerender } = mount({ annotating: false });
    expect(update).not.toHaveBeenCalled();
    rerender({ annotating: true });
    expect(update).toHaveBeenCalledWith({ mode: 'annotate' });
  });

  it('ne réarme pas le mode à chaque rendu — on pourrait en choisir un autre', () => {
    const { update, rerender } = mount({ annotating: true, mode: 'annotate' });
    update.mockClear();
    rerender({ annotating: true, mode: 'explore' });
    expect(update).not.toHaveBeenCalled();
  });

  it('sortir du mode éteint le bouton, qui ne reste pas allumé sur rien', () => {
    const { setAnnotating, rerender } = mount({ annotating: true, mode: 'annotate' });
    setAnnotating.mockClear();
    rerender({ annotating: true, mode: 'explore' });
    expect(setAnnotating).toHaveBeenCalledWith(false);
  });

  it('armer un outil de la scène range le crayon 2D, qui lui volait le pointeur', () => {
    // Le calque 2D couvre tout le cadre et capte le pointeur : sans cela, le clic destiné à la
    // surface n'atteignait jamais le canvas — brosse comme point d'intérêt restaient inertes.
    for (const tool of ['paint', 'paint-erase', 'pin'] as ToolId[]) {
      const { setAnnotating } = mount({ annotating: true, mode: 'annotate', tool });
      expect(setAnnotating).toHaveBeenCalledWith(false);
    }
  });

  it('laisse le crayon 2D à l’outil de repos — il reste ce qu’« Annoter » donne', () => {
    const { setAnnotating } = mount({ annotating: true, mode: 'annotate', tool: 'nav' });
    expect(setAnnotating).not.toHaveBeenCalled();
  });
});
