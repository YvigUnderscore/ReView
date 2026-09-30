// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnnotationCanvas, type Shape } from './AnnotationCanvas';

/**
 * Deux contrats :
 * - l'outil `ref` rend le canvas transparent au pointeur, sinon le calque des références
 *   collées ne reçoit jamais le geste et la référence reste clouée ;
 * - un glisser de forme porte **une seule** clé de geste : sans elle, l'annulation ne
 *   défaisait qu'un mouvement de souris sur les cent d'un déplacement.
 */
const rect = (x: number): Shape => ({
  id: 'r1',
  type: 'rect',
  color: '#ffffff',
  width: 3,
  x,
  y: 0.1,
  w: 0.4,
  h: 0.4,
});

const anchor = (svg: SVGSVGElement) => {
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 }) as DOMRect;
  svg.setPointerCapture = () => {};
  svg.releasePointerCapture = () => {};
};

const steps: (string | undefined)[] = [];

function MoveHost() {
  const [shapes, setShapes] = useState<Shape[]>([rect(0.1)]);
  return (
    <AnnotationCanvas
      shapes={shapes}
      onChange={(s, stepKey) => {
        steps.push(stepKey);
        setShapes(s);
      }}
      editable
      tool="move"
      color="#ffffff"
      width={3}
      alpha={1}
    />
  );
}

const canvas = (tool: 'draw' | 'ref') =>
  render(
    <AnnotationCanvas shapes={[rect(0.1)]} editable tool={tool} color="#ffffff" width={3} />,
  ).container.querySelector('svg')!;

describe('AnnotationCanvas', () => {
  it('capte le pointeur avec un outil de tracé', () => {
    expect(canvas('draw').style.pointerEvents).toBe('auto');
  });

  it('laisse passer le pointeur en mode pose de référence', () => {
    expect(canvas('ref').style.pointerEvents).toBe('none');
  });

  it('ne dessine rien en mode pose de référence', () => {
    const svg = canvas('ref');
    anchor(svg);
    fireEvent.pointerDown(svg, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 90, clientY: 90 });
    fireEvent.pointerUp(svg);
    expect(svg.querySelectorAll('rect')).toHaveLength(1);
  });

  it('marque tout un glisser d’une seule clé de geste', () => {
    steps.length = 0;
    const { container } = render(<MoveHost />);
    const svg = container.querySelector('svg')!;
    anchor(svg);

    fireEvent.pointerDown(svg, { clientX: 40, clientY: 40, button: 0 });
    for (const x of [50, 60, 80]) fireEvent.pointerMove(svg, { clientX: x, clientY: 40 });
    fireEvent.pointerUp(svg);

    expect(steps).toHaveLength(3);
    expect(new Set(steps).size).toBe(1);
    expect(steps[0]).toBeTruthy();
  });
});
