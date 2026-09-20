// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAnnotations, type Annotations } from './useAnnotations';
import type { ViewerBands } from './referenceBox';
import type { Shape } from '../../components/AnnotationCanvas';

/**
 * Quatre défauts verrouillés ici :
 * - la référence collée était posée hors cadre (x = 1.05), donc invisible ;
 * - la correction l'a ensuite collée d'office **sur** l'image : elle se pose maintenant dans
 *   la bande du letterbox dès que le viewer en laisse une ;
 * - déplacer empilait un cran d'annulation **par mouvement de souris** : Ctrl+Z ne rendait
 *   qu'un pixel ;
 * - aucun Ctrl+Z / Ctrl+Y / Ctrl+Maj+Z n'existait dans la review image.
 */
const DATA_URL = 'data:image/png;base64,AA';
/** Ce que publie le calque quand le viewer est plus large que le média (bandes latérales). */
const SIDE_BANDS = { left: 0.5, right: 0.5, top: 0, bottom: 0 };
const shape = (id: string, x = 0): Shape => ({ id, type: 'rect', color: '#fff', width: 3, x, y: 0 });

/**
 * Monte le composer et y colle une référence, comme le fait Ctrl+V sur le canvas. `bands`
 * simule ce que le calque mesure du viewer ; par défaut rien n'est mesuré (le média remplit
 * toute la zone), et la référence retombe alors sur un coin du média.
 */
function composer(withRef = true, bands?: ViewerBands) {
  const { result } = renderHook(() => useAnnotations());
  const ann = () => result.current;
  if (bands) act(() => ann().setRefBands(bands));
  if (withRef) act(() => ann().addStagedRef(DATA_URL));
  return { ann, ref: () => ann().stagedRefs[0] };
}

const ctrl = (key: string, shift = false) => {
  fireEvent.keyDown(document.body, { key, ctrlKey: true, shiftKey: shift });
};

const drag = (ann: () => Annotations, key: string, xs: number[]) => {
  for (const x of xs) act(() => ann().updateStagedRef(key, { x }, 'geste'));
};

describe('référence collée', () => {
  it('retombe dans le cadre, visible, quand le média remplit tout le viewer', () => {
    const { ref } = composer();
    expect(ref().x).toBeGreaterThan(0);
    expect(ref().x + ref().width).toBeLessThanOrEqual(1);
    expect(ref().y).toBeLessThan(0.5);
  });

  it('arme l’outil de déplacement de la référence, et non le dessin', () => {
    const { ann } = composer(false);
    expect(ann().tool).toBe('draw');
    act(() => ann().addStagedRef(DATA_URL));
    expect(ann().tool).toBe('ref');
  });

  it('rend la main à l’outil de tracé d’avant le collage', () => {
    const { ann } = composer(false);
    act(() => ann().setTool('arrow'));
    act(() => ann().addStagedRef(DATA_URL));
    act(() => ann().exitRefTool());
    expect(ann().tool).toBe('arrow');
  });

  it('se pose À CÔTÉ du média quand le viewer laisse une bande', () => {
    const { ref } = composer(true, SIDE_BANDS);
    expect(ref().x).toBeGreaterThanOrEqual(1);
  });

  it('garde un déplacement hors cadre tant qu’il reste dans la bande', () => {
    const { ann, ref } = composer(true, SIDE_BANDS);
    act(() => ann().updateStagedRef(ref().key, { x: -0.4, y: 0.2 }, 'geste'));
    expect(ref().x).toBeCloseTo(-0.4);
  });

  it('ne sort jamais de la zone atteignable, même poussée au-delà', () => {
    const { ann, ref } = composer(true, SIDE_BANDS);
    act(() => ann().updateStagedRef(ref().key, { x: 9, y: 9 }, 'geste'));
    expect(ref().x + ref().width).toBeLessThanOrEqual(1 + SIDE_BANDS.right);
    expect(ref().y).toBeLessThan(1);
  });

  it('s’en tient au cadre du média quand aucune bande n’est mesurée', () => {
    const { ann, ref } = composer();
    act(() => ann().updateStagedRef(ref().key, { x: 3, y: 3 }, 'geste'));
    expect(ref().x + ref().width).toBeLessThanOrEqual(1);
    expect(ref().y).toBeLessThan(1);
  });
});

describe('un geste = un cran d’annulation', () => {
  it('défait tout le glisser d’une référence, pas son dernier pixel', () => {
    const { ann, ref } = composer();
    const start = ref().x;
    drag(ann, ref().key, [0.2, 0.3, 0.4]);
    expect(ref().x).toBeCloseTo(0.4);

    act(() => ann().undo());
    expect(ref().x).toBeCloseTo(start);
    expect(ann().stagedRefs).toHaveLength(1);
  });

  it('défait tout le glisser d’une forme, pas son dernier pixel', () => {
    const { ann } = composer(false);
    act(() => ann().setAnnotating(true));
    act(() => ann().setShapes([shape('a')]));
    for (const x of [0.1, 0.2, 0.3]) act(() => ann().setShapes([shape('a', x)], 'glisser'));

    act(() => ann().undo());
    expect(ann().annot[0].x).toBe(0);
    expect(ann().annot).toHaveLength(1);
  });

  it('sépare deux gestes distincts', () => {
    const { ann, ref } = composer();
    act(() => ann().updateStagedRef(ref().key, { x: 0.2 }, 'g1'));
    act(() => ann().updateStagedRef(ref().key, { x: 0.5 }, 'g2'));
    act(() => ann().undo());
    expect(ref().x).toBeCloseTo(0.2);
  });
});

describe('raccourcis clavier de l’annotation', () => {
  it('Ctrl+Z défait le geste entier, Ctrl+Maj+Z le refait', () => {
    const { ann, ref } = composer();
    const start = ref().x;
    drag(ann, ref().key, [0.2, 0.45]);

    act(() => ctrl('z'));
    expect(ref().x).toBeCloseTo(start);
    act(() => ctrl('Z', true));
    expect(ref().x).toBeCloseTo(0.45);
  });

  it('Ctrl+Y refait aussi', () => {
    const { ann, ref } = composer();
    drag(ann, ref().key, [0.45]);
    act(() => ctrl('z'));
    act(() => ctrl('y'));
    expect(ref().x).toBeCloseTo(0.45);
  });

  it('défait aussi les formes', () => {
    const { ann } = composer(false);
    act(() => ann().setAnnotating(true));
    act(() => ann().setShapes([shape('a')]));
    act(() => ctrl('z'));
    expect(ann().annot).toHaveLength(0);
  });

  it('laisse passer le raccourci quand il n’y a rien à défaire', () => {
    const { ann } = composer(false);
    act(() => ann().setAnnotating(true));
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it('ne s’empare pas du clavier dans un champ de saisie', () => {
    const { ann, ref } = composer();
    drag(ann, ref().key, [0.45]);
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    });
    expect(ref().x).toBeCloseTo(0.45);
    input.remove();
  });
});
