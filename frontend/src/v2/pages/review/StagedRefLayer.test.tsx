// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StagedRefLayer from './StagedRefLayer';
import { useAnnotations, type Annotations } from './useAnnotations';
import { t } from '../../i18n';

/**
 * Une référence collée ne se déplaçait plus dès que l'annotation était armée : le canvas
 * d'annotation, rendu au-dessus, avalait le pointeur. Le calque des références porte donc
 * ses propres événements, et le fait **quel que soit l'outil de tracé armé**.
 */
const probe: { ann: Annotations | null } = { ann: null };
/** État du composer après le dernier rendu — publié hors du render, jamais pendant. */
const ann = () => probe.ann!;

function Host() {
  const composer = useAnnotations();
  useEffect(() => {
    probe.ann = composer;
  });
  return <StagedRefLayer ann={composer} />;
}

/** Ancre le calque à une géométrie connue : happy-dom ne mesure rien. */
const grab = () => {
  const box = screen.getByTitle(t('review.ref.drag'));
  const root = box.parentElement!;
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
  box.setPointerCapture = () => {};
  return box;
};

describe('StagedRefLayer', () => {
  it('ne pose aucun calque tant que rien n’est collé', () => {
    const { container } = render(<Host />);
    expect(container).toBeEmptyDOMElement();
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
    const { container } = render(<Host />);
    act(() => ann().addStagedRef('data:image/png;base64,AA'));
    act(() => void fireEvent.click(screen.getByTitle(t('review.ref.remove'))));
    expect(container).toBeEmptyDOMElement();
  });
});
