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
 * The "Annotate" ↔ rail bridge for spatial viewers. Without it, clicking "Annotate" on a scene only
 * armed the 2D drawing layer: the rail stayed in exploration, and the scene's annotation tools
 * appeared nowhere. This is the failure the user described.
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
  it('the "Annotate" button arms the rail mode', () => {
    const { update, rerender } = mount({ annotating: false });
    expect(update).not.toHaveBeenCalled();
    rerender({ annotating: true });
    expect(update).toHaveBeenCalledWith({ mode: 'annotate' });
  });

  it('does not re-arm the mode on every render — one could have chosen another', () => {
    const { update, rerender } = mount({ annotating: true, mode: 'annotate' });
    update.mockClear();
    rerender({ annotating: true, mode: 'explore' });
    expect(update).not.toHaveBeenCalled();
  });

  it('leaving the mode turns the button off, so it does not stay lit on nothing', () => {
    const { setAnnotating, rerender } = mount({ annotating: true, mode: 'annotate' });
    setAnnotating.mockClear();
    rerender({ annotating: true, mode: 'explore' });
    expect(setAnnotating).toHaveBeenCalledWith(false);
  });

  it('arming a scene tool stows the 2D pencil, which was stealing the pointer', () => {
    // The 2D layer covers the whole frame and captures the pointer: without this, the click meant for the
    // surface never reached the canvas — brush and point of interest both stayed inert.
    for (const tool of ['paint', 'paint-erase', 'pin'] as ToolId[]) {
      const { setAnnotating } = mount({ annotating: true, mode: 'annotate', tool });
      expect(setAnnotating).toHaveBeenCalledWith(false);
    }
  });

  it('leaves the 2D pencil to the idle tool — it stays what "Annotate" gives', () => {
    const { setAnnotating } = mount({ annotating: true, mode: 'annotate', tool: 'nav' });
    expect(setAnnotating).not.toHaveBeenCalled();
  });
});
