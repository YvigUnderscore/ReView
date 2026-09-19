// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAnnotations, type Annotations } from './useAnnotations';
import type { Shape } from '../../components/AnnotationCanvas';

/**
 * Trois défauts verrouillés ici :
 * - la référence collée était posée hors cadre (x = 1.05), donc invisible ;
 * - déplacer empilait un cran d'annulation **par mouvement de souris** : Ctrl+Z ne rendait
 *   qu'un pixel ;
 * - aucun Ctrl+Z / Ctrl+Y / Ctrl+Maj+Z n'existait dans la review image.
 */
const DATA_URL = 'data:image/png;base64,AA';
const shape = (id: string, x = 0): Shape => ({ id, type: 'rect', color: '#fff', width: 3, x, y: 0 });

/** Monte le composer et y colle une référence, comme le fait Ctrl+V sur le canvas. */
function composer(withRef = true) {
  const { result } = renderHook(() => useAnnotations());
  const ann = () => result.current;
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
  it('atterrit dans le cadre, visible', () => {
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

  it('ne sort jamais du cadre, même poussée au-delà', () => {
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
