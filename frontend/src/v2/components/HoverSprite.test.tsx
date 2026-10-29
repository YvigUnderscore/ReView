// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HoverSprite, { type SpriteData } from './HoverSprite';

/**
 * The hover contact sheet weighs several hundred kilobytes (up to 240
 * thumbnails of 160 px). The Reviews page shows a hundred per page: as long as nobody
 * hovers, **none** must go out on the network.
 *
 * The quantity measured is therefore a **number of requests**, counted on both sides from where
 * they can originate: JS preloading (`new Image()`) and the CSS background (a `url()`
 * set on a rendered element is a request, `opacity: 0` does not defer it; only
 * `display: none` would).
 */

interface PendingImage {
  url: string;
  /** Simulates the end of the download on the browser side. */
  load: () => void;
}

/** Preload requests observed during a test. */
const pending: PendingImage[] = [];

/** Substitute `Image`: it records the request instead of emitting it. */
class FakeImage {
  private handlers: Record<string, (() => void)[]> = {};
  private url = '';

  get src(): string {
    return this.url;
  }

  set src(value: string) {
    this.url = value;
    pending.push({ url: value, load: () => (this.handlers.load ?? []).forEach((h) => h()) });
  }

  addEventListener(type: string, fn: () => void): void {
    (this.handlers[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.handlers[type] = (this.handlers[type] ?? []).filter((h) => h !== fn);
  }
}

const sprite = (i: number): SpriteData => ({
  url: `https://minio/sprite-${i}.jpg`,
  count: 24,
  cols: 6,
  rows: 4,
});

/** A page of cards, each capped with its hover preview. */
function Grid({ size }: { size: number }) {
  return (
    <div>
      {Array.from({ length: size }, (_, i) => (
        <div key={i} data-testid={`card-${i}`} className="relative">
          <HoverSprite sprite={sprite(i)} />
        </div>
      ))}
    </div>
  );
}

/** Elements whose style calls for a mosaic from the network. */
const painted = (root: HTMLElement) => root.querySelectorAll('[style*="minio/sprite-"]').length;

const overlayOf = (index: number) => screen.getByTestId(`card-${index}`).firstElementChild as HTMLElement;

describe('HoverSprite — the mosaic is only fetched on hover', () => {
  beforeEach(() => {
    pending.length = 0;
    vi.stubGlobal('Image', FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('requests no mosaic on a page of a hundred cards', () => {
    const { container } = render(<Grid size={100} />);

    expect(pending).toHaveLength(0);
    expect(painted(container)).toBe(0);
  });

  it('fetches only the one hovered, once, and without showing it half-loaded', async () => {
    const user = userEvent.setup();
    const { container } = render(<Grid size={100} />);

    await user.hover(overlayOf(7));
    expect(pending.map((p) => p.url)).toEqual(['https://minio/sprite-7.jpg']);
    // Nothing is painted yet: a CSS background still loading would appear in
    // strips under the fade. The card always shows its static thumbnail.
    expect(painted(container)).toBe(0);
    expect(overlayOf(7).style.opacity).toBe('0');

    act(() => pending[0].load());
    expect(painted(container)).toBe(1);
    expect(overlayOf(7).style.backgroundImage).toContain('sprite-7.jpg');
    expect(overlayOf(7).style.opacity).toBe('1');

    // The neighbour asked for nothing.
    expect(overlayOf(8).style.backgroundImage).toBe('');

    // Leaving and coming back requests nothing again: the flag is sticky, the second hover
    // is instantaneous.
    await user.unhover(overlayOf(7));
    expect(overlayOf(7).style.opacity).toBe('0');
    await user.hover(overlayOf(7));
    expect(pending).toHaveLength(1);
    expect(overlayOf(7).style.opacity).toBe('1');
  });

  it('scrolls the thumbnails once the mosaic is loaded', () => {
    vi.useFakeTimers();
    render(<Grid size={3} />);

    // `fireEvent` rather than `userEvent`: the latter schedules its gestures on real
    // delays, which simulated timers do not advance.
    fireEvent.mouseOver(overlayOf(1));
    act(() => pending[0].load());
    const first = overlayOf(1).style.backgroundPosition;

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(overlayOf(1).style.backgroundPosition).not.toBe(first);
  });
});
