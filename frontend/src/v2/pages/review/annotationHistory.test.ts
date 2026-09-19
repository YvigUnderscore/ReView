// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, pushStep, redoStep, undoStep, type AnnotationSnapshot } from './annotationHistory';
import type { Shape } from '../../components/AnnotationCanvas';

const shape = (id: string): Shape => ({ id, type: 'rect', color: '#fff', width: 3 });
const snap = (shapes: Shape[], refs: AnnotationSnapshot['refs'] = []): AnnotationSnapshot => ({
  shapes,
  refs,
});
const ref = (x: number) => ({ key: 'k', dataUrl: 'data:image/png;base64,AA', x, y: 0.1, width: 0.3 });

describe('historique d’annotation', () => {
  it('ne défait rien quand rien n’a été fait', () => {
    expect(undoStep(EMPTY_HISTORY, snap([]))).toBeNull();
    expect(redoStep(EMPTY_HISTORY, snap([]))).toBeNull();
  });

  it('rend l’état précédent, puis le refait', () => {
    const h = pushStep(EMPTY_HISTORY, snap([shape('a')]));
    const undone = undoStep(h, snap([shape('a'), shape('b')]));
    expect(undone?.snapshot.shapes).toHaveLength(1);
    const redone = redoStep(undone!.history, undone!.snapshot);
    expect(redone?.snapshot.shapes).toHaveLength(2);
  });

  it('couvre les formes et les références collées d’un seul cran', () => {
    const before = snap([], [ref(0.06)]);
    const h = pushStep(EMPTY_HISTORY, before);
    const undone = undoStep(h, snap([shape('a')], [ref(0.4)]));
    expect(undone?.snapshot.refs[0]?.x).toBeCloseTo(0.06);
    expect(undone?.snapshot.shapes).toHaveLength(0);
  });

  it('rend le futur inatteignable dès qu’on repart d’un état défait', () => {
    const h = pushStep(EMPTY_HISTORY, snap([shape('a')]));
    const undone = undoStep(h, snap([shape('a'), shape('b')]))!;
    expect(undone.history.future).toHaveLength(1);
    expect(pushStep(undone.history, snap([shape('c')])).future).toHaveLength(0);
  });
});
