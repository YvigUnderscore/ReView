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
  fit: scale === 1,
});

const still = { visible: false, speed: 1 };

describe('ViewerBadges', () => {
  it('lecteur au repos, ajusté : aucun repère à l’écran', () => {
    const { container } = render(
      <ViewerBadges zoom={zoomAt(1)} playbackSpeed={still} buffering={false} switchingQuality={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('zoomé : le taux s’affiche et ramène à l’ajustement d’un clic', () => {
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

  it('lecture arrière et chargement se signalent chacun de leur côté', () => {
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
