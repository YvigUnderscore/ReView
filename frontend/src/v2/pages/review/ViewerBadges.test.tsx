// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ViewerBadges from './ViewerBadges';
import type { ViewportZoom } from './zoom/useViewportZoom';

const zoomAt = (scale: number, reset = () => {}): ViewportZoom => ({
  state: { scale, x: 0, y: 0 },
  style: {},
  handlers: { onPointerDown: () => {}, onPointerMove: () => {}, onPointerUp: () => {} },
  consumeClick: () => false,
  zoomBy: () => {},
  reset,
  oneToOne: () => {},
  fit: scale === 1,
});

const still = { visible: false, speed: 1 };

describe('ViewerBadges', () => {
  it('idle player, fitted: no marker on screen', () => {
    const { container } = render(
      <ViewerBadges zoom={zoomAt(1)} playbackSpeed={still} buffering={false} switchingQuality={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('zoomed: the level is shown and one click returns to fit', () => {
    const reset = vi.fn();
    render(
      <ViewerBadges
        zoom={zoomAt(2.4, reset)}
        playbackSpeed={still}
        buffering={false}
        switchingQuality={false}
      />,
    );
    const badge = screen.getByRole('button');
    expect(badge).toHaveTextContent('240%');
    fireEvent.click(badge);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('reverse playback and loading each signal themselves separately', () => {
    const { container } = render(
      <ViewerBadges
        zoom={zoomAt(1)}
        playbackSpeed={{ visible: true, speed: -4 }}
        buffering
        switchingQuality={false}
      />,
    );
    expect(container).toHaveTextContent('×4');
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});
