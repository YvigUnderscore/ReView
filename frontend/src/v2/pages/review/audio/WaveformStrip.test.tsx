// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WaveformStrip from './WaveformStrip';
import type { WaveformTrack } from './useWaveform';

const peaks = Uint8Array.from(Array.from({ length: 64 }, (_, i) => (i < 32 ? 0 : 255)));

/** Piste telle que `useWaveform` la rend au lecteur. */
const track = (visible = true): WaveformTrack => ({
  available: true,
  peaks: visible ? peaks : null,
  visible,
  toggle: () => {},
});

/** Ancre la bande à une géométrie connue : happy-dom ne mesure rien. */
const anchor = (el: HTMLElement) => {
  el.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 32 }) as DOMRect;
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
};

describe('WaveformStrip', () => {
  it('dessine le tracé deux fois : le fond et la partie lue, découpée à la position', () => {
    const { container } = render(<WaveformStrip track={track()} duration={10} time={5} onSeek={() => {}} />);
    const groups = container.querySelectorAll('svg > g');
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelectorAll('rect').length).toBeGreaterThan(0);
    // Les deux calques portent exactement le même tracé.
    expect(groups[1].querySelectorAll('rect')).toHaveLength(groups[0].querySelectorAll('rect').length);
    const clip = container.querySelector('clipPath rect')!;
    const bars = groups[0].querySelectorAll('rect').length;
    expect(Number(clip.getAttribute('width'))).toBeCloseTo(bars / 2, 6);
  });

  it('à l’arrêt sur la première frame, rien n’est peint comme lu', () => {
    const { container } = render(<WaveformStrip track={track()} duration={10} time={0} onSeek={() => {}} />);
    expect(Number(container.querySelector('clipPath rect')!.getAttribute('width'))).toBe(0);
  });

  it('piste masquée ou média muet : rien sous la timeline', () => {
    const hidden = render(<WaveformStrip track={track(false)} duration={10} time={0} onSeek={() => {}} />);
    expect(hidden.container).toBeEmptyDOMElement();
    hidden.unmount();
    const noDuration = render(<WaveformStrip track={track()} duration={0} time={0} onSeek={() => {}} />);
    expect(noDuration.container).toBeEmptyDOMElement();
  });

  it('un clic dans la bande déplace la lecture à l’instant pointé', () => {
    const onSeek = vi.fn();
    const { container } = render(<WaveformStrip track={track()} duration={10} time={0} onSeek={onSeek} />);
    const strip = container.firstElementChild as HTMLElement;
    anchor(strip);
    fireEvent.pointerDown(strip, { button: 0, clientX: 50, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(2.5);
  });

  it('glisser continue le scrub, relâcher l’arrête', () => {
    const onSeek = vi.fn();
    const { container } = render(<WaveformStrip track={track()} duration={10} time={0} onSeek={onSeek} />);
    const strip = container.firstElementChild as HTMLElement;
    anchor(strip);
    fireEvent.pointerMove(strip, { clientX: 100, pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
    fireEvent.pointerDown(strip, { button: 0, clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 100, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(5);
    fireEvent.pointerUp(strip, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 180, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(5);
  });
});
