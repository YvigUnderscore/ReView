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
 * Le reproche de départ : « la taille des guides n'est pas la même partout ». Ces tests
 * verrouillent le remède — **un seul** jeu de constantes alimente tous les traits, porté par
 * le groupe du calque, et aucun repère ne redéfinit le sien. Le liseré du cadre de livraison
 * (ReviewFrame), qui avait sa propre bordure CSS, est tenu au même contrat.
 */

/** happy-dom ne met rien en page : on lui donne un conteneur mesurable pour ReviewFrame. */
const stubLayout = (w: number, h: number) => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: h });
};

const allGuidesOn = () =>
  useGuides.setState({ guides: { thirds: true, center: true, actionSafe: true, titleSafe: true } });

/** Attributs de trait du groupe unique d'un calque de repères. */
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
  // Rendu au prototype : les autres suites mesurent zéro, comme avant.
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

describe('CompositionGuides — un seul jeu de constantes', () => {
  it('ne pose aucun calque tant qu’aucun repère n’est actif', () => {
    const { container } = render(<CompositionGuides />);
    expect(container).toBeEmptyDOMElement();
  });

  it('porte couleur, épaisseur et opacité sur le groupe, une fois pour tous les repères', () => {
    allGuidesOn();
    const { container } = render(<CompositionGuides />);
    const stroke = strokeOf(container);
    expect(stroke.fill).toBe('none');
    expect(stroke.stroke).toBe(GUIDE_COLOR);
    expect(stroke.width).toBe(String(guideStrokeWidth(1)));
    expect(stroke.opacity).toBe(String(GUIDE_OPACITY));
    expect(stroke.filter).toMatch(/^url\(#review-guide-shadow-[a-zA-Z0-9_-]+\)$/);
  });

  it('ne laisse aucun repère redéfinir son trait', () => {
    allGuidesOn();
    const { container } = render(<CompositionGuides />);
    const shapes = container.querySelectorAll('line, rect');
    // Tiers (4) + croix (2) + action safe + title safe.
    expect(shapes).toHaveLength(8);
    for (const shape of shapes) {
      expect(shape.getAttribute('stroke')).toBeNull();
      expect(shape.getAttribute('stroke-width')).toBeNull();
      expect(shape.getAttribute('stroke-opacity')).toBeNull();
    }
  });

  it('distingue le repère titre par les tirets partagés, pas par l’épaisseur', () => {
    allGuidesOn();
    const { container } = render(<CompositionGuides />);
    const dashed = container.querySelectorAll('[stroke-dasharray]');
    expect(dashed).toHaveLength(1);
    expect(dashed[0].getAttribute('data-guide')).toBe('titleSafe');
    expect(dashed[0].getAttribute('stroke-dasharray')).toBe(guideDashArray(1));
  });

  it('pose l’ombre portée du module de constantes', () => {
    allGuidesOn();
    const { container } = render(<CompositionGuides />);
    const shadow = container.querySelector('feDropShadow');
    expect(shadow?.getAttribute('stdDeviation')).toBe(String(guideShadowBlur(1)));
    expect(shadow?.getAttribute('flood-color')).toBe(GUIDE_SHADOW_COLOR);
    expect(shadow?.getAttribute('flood-opacity')).toBe(String(GUIDE_SHADOW_OPACITY));
  });

  it('donne un filtre propre à chaque calque (deux lecteurs côte à côte)', () => {
    allGuidesOn();
    const a = render(<CompositionGuides />).container.querySelector('filter')?.id;
    const b = render(<CompositionGuides />).container.querySelector('filter')?.id;
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('ReviewFrame — le liseré parle le même langage', () => {
  it('trace le cadre de livraison avec le trait des repères de composition', () => {
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

  it('rentre le liseré d’un demi-trait pour ne pas être rogné', () => {
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
