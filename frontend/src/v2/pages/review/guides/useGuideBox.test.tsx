// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FALLBACK_GUIDE_BOX, useGuideBox } from './useGuideBox';

/**
 * The guide overlay lives in the player's zoomed layer: without compensation, its strokes thicken
 * with the zoom. The hook reads the scale by comparing the screen rectangle (transforms included)
 * with the layout size (which ignores them).
 */
function Host({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useGuideBox(ref, enabled);
  return (
    <div ref={ref} data-testid="host">
      {`${box.w}x${box.h}@${box.scale}`}
    </div>
  );
}

/** Sets a measurable layout: happy-dom returns zero everywhere. */
const stubLayout = (layoutW: number, layoutH: number, screenW: number) => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: layoutW });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: layoutH });
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: screenW, height: layoutH }) as DOMRect,
  });
};

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
});

describe('useGuideBox', () => {
  it('reads the scale of the transformed layer from the first render', () => {
    stubLayout(800, 450, 3200);
    render(<Host enabled />);
    expect(screen.getByTestId('host')).toHaveTextContent('800x450@4');
  });

  it('equals 1 when nothing is transformed', () => {
    stubLayout(800, 450, 800);
    render(<Host enabled />);
    expect(screen.getByTestId('host')).toHaveTextContent('800x450@1');
  });

  it('measures nothing as long as no guide is displayed', () => {
    stubLayout(800, 450, 3200);
    render(<Host enabled={false} />);
    const { w, h, scale } = FALLBACK_GUIDE_BOX;
    expect(screen.getByTestId('host')).toHaveTextContent(`${w}x${h}@${scale}`);
  });

  it('keeps the fallback box when the layout measures nothing', () => {
    render(<Host enabled />);
    const { w, h, scale } = FALLBACK_GUIDE_BOX;
    expect(screen.getByTestId('host')).toHaveTextContent(`${w}x${h}@${scale}`);
  });
});
