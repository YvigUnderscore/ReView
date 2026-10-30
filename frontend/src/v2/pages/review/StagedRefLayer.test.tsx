// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StagedRefLayer from './StagedRefLayer';
import { useAnnotations, type Annotations } from './useAnnotations';
import { t } from '../../i18n';

/**
 * Two regressions are locked down here. A pasted reference could no longer be moved once
 * annotation was armed: the annotation canvas, rendered above, swallowed the pointer — so the
 * layer carries its own events, whatever drawing tool is armed. And moving stayed confined to
 * the media frame: it now goes everywhere on the viewer canvas, at the exact pointer position,
 * without ever letting the reference leave what is visible.
 */
const probe: { ann: Annotations | null } = { ann: null };
/** Composer state after the last render — published outside render, never during it. */
const ann = () => probe.ann!;

/** The layer lives in the image plane, itself clipped by the viewer: hence the container. */
function Host() {
  const composer = useAnnotations();
  useEffect(() => {
    probe.ann = composer;
  });
  return (
    <div data-testid="viewer" style={{ overflow: 'hidden' }}>
      <StagedRefLayer ann={composer} />
    </div>
  );
}

/** The layer, empty or not: it is what we inspect, the container always stays there. */
const layer = () => screen.getByTestId('viewer');

/**
 * Anchors the layer to a known geometry: happy-dom measures nothing. `zoom` simulates the
 * enlarged image plane — the layer is rendered there, its box grows accordingly, and the same
 * mouse path is therefore worth fewer image fractions.
 */
const grab = (zoom = 1) => {
  const box = screen.getByTitle(t('review.ref.drag'));
  const root = box.parentElement!;
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400 * zoom, height: 300 * zoom }) as DOMRect;
  // The clipping viewer: three times as wide and twice as tall as the media, so there is room
  // free all around it — a letterbox, as on screen.
  layer().getBoundingClientRect = () =>
    ({
      left: -400 * zoom,
      top: -150 * zoom,
      width: 1200 * zoom,
      height: 600 * zoom,
      right: 800 * zoom,
      bottom: 450 * zoom,
    }) as DOMRect;
  box.setPointerCapture = () => {};
  return box;
};

describe('StagedRefLayer', () => {
  it('ne pose aucun calque tant que rien n’est collé', () => {
    render(<Host />);
    expect(layer()).toBeEmptyDOMElement();
  });

  it('déplace la référence alors qu’un outil de tracé est armé', () => {
    render(<Host />);
    act(() => ann().addStagedRef('data:image/png;base64,AA'));
    act(() => ann().setTool('draw'));
    const start = ann().stagedRefs[0];

    const box = grab();
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(box, { clientX: 140, clientY: 130 });
    fireEvent.pointerUp(box);

    expect(ann().stagedRefs[0].x).toBeCloseTo(start.x + 0.1);
    expect(ann().stagedRefs[0].y).toBeCloseTo(start.y + 0.1);
  });

  it('lâche la référence hors du cadre du média, au point exact du pointeur', () => {
    render(<Host />);
    act(() => ann().addStagedRef('data:image/png;base64,AA'));
    const start = ann().stagedRefs[0];

    const box = grab();
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, button: 0 });
    // 500 px to the right on 400 wide: well beyond the image edge.
    fireEvent.pointerMove(box, { clientX: 600, clientY: 40 });
    fireEvent.pointerUp(box);

    expect(ann().stagedRefs[0].x).toBeCloseTo(start.x + 1.25);
    expect(ann().stagedRefs[0].y).toBeCloseTo(start.y - 0.2);
  });

  it('retient la référence au bord du viewer plutôt que de la laisser se perdre', () => {
    render(<Host />);
    act(() => ann().addStagedRef('data:image/png;base64,AA'));

    const box = grab();
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(box, { clientX: 2100, clientY: 100 });
    fireEvent.pointerUp(box);

    // Measured right edge of the canvas (x = 2) minus the part that must remain grabbable.
    expect(ann().stagedRefs[0].x).toBeCloseTo(1.95);
  });

  it('suit le pointeur au même endroit quand le plan de l’image est zoomé', () => {
    render(<Host />);
    act(() => ann().addStagedRef('data:image/png;base64,AA'));
    const start = ann().stagedRefs[0];

    const box = grab(2);
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(box, { clientX: 500, clientY: 100 });
    fireEvent.pointerUp(box);

    expect(ann().stagedRefs[0].x).toBeCloseTo(start.x + 0.5);
  });

  it('compte le glisser entier pour un seul cran d’annulation', () => {
    render(<Host />);
    act(() => ann().addStagedRef('data:image/png;base64,AA'));
    const start = ann().stagedRefs[0].x;

    const box = grab();
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, button: 0 });
    for (const x of [110, 120, 140]) fireEvent.pointerMove(box, { clientX: x, clientY: 100 });
    fireEvent.pointerUp(box);
    expect(ann().stagedRefs[0].x).toBeCloseTo(start + 0.1);

    act(() => ann().undo());
    expect(ann().stagedRefs[0].x).toBeCloseTo(start);
  });

  it('redimensionne par la poignée', () => {
    render(<Host />);
    act(() => ann().addStagedRef('data:image/png;base64,AA'));
    const start = ann().stagedRefs[0].width;
    const handle = screen.getByTitle(t('common.resize'));
    grab();
    handle.setPointerCapture = () => {};
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 180, clientY: 100 });
    fireEvent.pointerUp(handle);
    expect(ann().stagedRefs[0].width).toBeCloseTo(start + 0.2);
  });

  it('un geste posé ailleurs rend la main à l’outil de tracé', () => {
    render(<Host />);
    act(() => ann().setTool('rect'));
    act(() => ann().addStagedRef('data:image/png;base64,AA'));
    expect(ann().tool).toBe('ref');
    act(() => void fireEvent.pointerDown(document.body, { clientX: 5, clientY: 5 }));
    expect(ann().tool).toBe('rect');
  });

  it('retire la référence sans laisser de calque vide', () => {
    render(<Host />);
    act(() => ann().addStagedRef('data:image/png;base64,AA'));
    act(() => void fireEvent.click(screen.getByTitle(t('review.ref.remove'))));
    expect(layer()).toBeEmptyDOMElement();
  });
});
