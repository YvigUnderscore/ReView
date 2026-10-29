// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import CompositionGuides from '../CompositionGuides';
import ReviewFrame from '../ReviewFrame';
import { useGuides } from '../../../stores/useGuides';
import {
  GUIDE_COLOR,
  GUIDE_OPACITY,
  GUIDE_SHADOW_COLOR,
  GUIDE_SHADOW_OPACITY,
  guideDashArray,
  guideShadowBlur,
  guideStrokeWidth,
} from './guideStyle';

/**
 * The starting complaint: "the size of the guides is not the same everywhere". These tests
 * lock in the remedy: **a single** set of constants feeds all the strokes, carried by the group
 * of the layer, and no marker redefines its own. The border of the delivery frame (ReviewFrame),
 * which had its own CSS border, is held to the same contract.
 */

/** happy-dom lays nothing out: we give it a measurable container for ReviewFrame. */
const stubLayout = (w: number, h: number) => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: h });
};

const allGuidesOn = () =>
  useGuides.setState({ guides: { thirds: true, center: true, actionSafe: true, titleSafe: true } });

/** Stroke attributes of the single group of a guide layer. */
const strokeOf = (root: ParentNode) => {
  const groups = root.querySelectorAll('g');
  expect(groups).toHaveLength(1);
  const g = groups[0];
  return {
    fill: g.getAttribute('fill'),
    stroke: g.getAttribute('stroke'),
    width: g.getAttribute('stroke-width'),
    opacity: g.getAttribute('stroke-opacity'),
    filter: g.getAttribute('filter'),
  };
};

afterEach(() => {
  useGuides.setState({
    guides: { thirds: false, center: false, actionSafe: false, titleSafe: false },
  });
  // Rendered to the prototype: the other suites measure zero, as before.
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

describe('CompositionGuides — a single set of constants', () => {
  it('mounts no layer as long as no guide is active', () => {
    const { container } = render(<CompositionGuides />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sets colour, thickness and opacity on the group, once for all guides', () => {
    allGuidesOn();
    const { container } = render(<CompositionGuides />);
    const stroke = strokeOf(container);
    expect(stroke.fill).toBe('none');
    expect(stroke.stroke).toBe(GUIDE_COLOR);
    expect(stroke.width).toBe(String(guideStrokeWidth(1)));
    expect(stroke.opacity).toBe(String(GUIDE_OPACITY));
    expect(stroke.filter).toMatch(/^url\(#review-guide-shadow-[a-zA-Z0-9_-]+\)$/);
  });

  it('lets no guide redefine its own stroke', () => {
    allGuidesOn();
    const { container } = render(<CompositionGuides />);
    const shapes = container.querySelectorAll('line, rect');
    // Thirds (4) + cross (2) + action safe + title safe.
    expect(shapes).toHaveLength(8);
    for (const shape of shapes) {
      expect(shape.getAttribute('stroke')).toBeNull();
      expect(shape.getAttribute('stroke-width')).toBeNull();
      expect(shape.getAttribute('stroke-opacity')).toBeNull();
    }
  });

  it('distinguishes the title guide by its shared dashes, not by thickness', () => {
    allGuidesOn();
    const { container } = render(<CompositionGuides />);
    const dashed = container.querySelectorAll('[stroke-dasharray]');
    expect(dashed).toHaveLength(1);
    expect(dashed[0].getAttribute('data-guide')).toBe('titleSafe');
    expect(dashed[0].getAttribute('stroke-dasharray')).toBe(guideDashArray(1));
  });

  it('sets the drop shadow of the constants module', () => {
    allGuidesOn();
    const { container } = render(<CompositionGuides />);
    const shadow = container.querySelector('feDropShadow');
    expect(shadow?.getAttribute('stdDeviation')).toBe(String(guideShadowBlur(1)));
    expect(shadow?.getAttribute('flood-color')).toBe(GUIDE_SHADOW_COLOR);
    expect(shadow?.getAttribute('flood-opacity')).toBe(String(GUIDE_SHADOW_OPACITY));
  });

  it('gives each layer its own filter (two players side by side)', () => {
    allGuidesOn();
    const a = render(<CompositionGuides />).container.querySelector('filter')?.id;
    const b = render(<CompositionGuides />).container.querySelector('filter')?.id;
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('ReviewFrame — the border speaks the same language', () => {
  it('traces the delivery frame with the stroke of the composition guides', () => {
    stubLayout(1000, 400);
    allGuidesOn();
    const guides = render(<CompositionGuides />).container;
    const frame = render(
      <ReviewFrame aspect={16 / 9}>
        <div />
      </ReviewFrame>,
    ).container;

    const outline = frame.querySelector('[data-guide="frame"]');
    expect(outline).toBeTruthy();
    const { filter: _a, ...frameStroke } = strokeOf(frame);
    const { filter: _b, ...guidesStroke } = strokeOf(guides);
    expect(frameStroke).toEqual(guidesStroke);
  });

  it('insets the border by half a stroke so that it is not clipped', () => {
    stubLayout(1000, 400);
    const { container } = render(
      <ReviewFrame aspect={16 / 9}>
        <div />
      </ReviewFrame>,
    );
    const outline = container.querySelector('[data-guide="frame"]');
    expect(outline?.getAttribute('x')).toBe(String(guideStrokeWidth(1) / 2));
    expect(outline?.getAttribute('y')).toBe(String(guideStrokeWidth(1) / 2));
  });
});
