// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FALLBACK_GUIDE_BOX, useGuideBox } from './useGuideBox';

/**
 * L'overlay des repères vit dans le calque zoomé du lecteur : sans compensation, ses traits
 * s'épaississent avec le zoom. Le hook relève l'échelle en comparant le rectangle écran
 * (transformations comprises) à la taille de mise en page (qui les ignore).
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

/** Pose une mise en page mesurable : happy-dom rend zéro partout. */
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
  it('relève l’échelle du calque transformé dès le premier rendu', () => {
    stubLayout(800, 450, 3200);
    render(<Host enabled />);
    expect(screen.getByTestId('host')).toHaveTextContent('800x450@4');
  });

  it('vaut 1 quand rien n’est transformé', () => {
    stubLayout(800, 450, 800);
    render(<Host enabled />);
    expect(screen.getByTestId('host')).toHaveTextContent('800x450@1');
  });

  it('ne mesure rien tant qu’aucun repère n’est affiché', () => {
    stubLayout(800, 450, 3200);
    render(<Host enabled={false} />);
    const { w, h, scale } = FALLBACK_GUIDE_BOX;
    expect(screen.getByTestId('host')).toHaveTextContent(`${w}x${h}@${scale}`);
  });

  it('garde la boîte de repli quand la mise en page ne mesure rien', () => {
    render(<Host enabled />);
    const { w, h, scale } = FALLBACK_GUIDE_BOX;
    expect(screen.getByTestId('host')).toHaveTextContent(`${w}x${h}@${scale}`);
  });
});
