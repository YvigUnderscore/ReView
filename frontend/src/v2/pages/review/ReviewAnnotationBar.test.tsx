// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, type ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReviewAnnotationBar from './ReviewAnnotationBar';
import Model3DThreePane from './Model3DThreePane';
import SplatPane from './splat/SplatPane';
import { useAnnotations, type Annotations } from './useAnnotations';
import type { Shape } from '../../components/AnnotationCanvas';
import { t } from '../../i18n';

/**
 * La sortie de la lecture d'un commentaire annoté se posait dans la section de review, dont le
 * premier enfant est l'en-tête du chrome : elle tombait donc sur la bascule de mode, elle aussi
 * centrée. Elle vit désormais DANS la zone média — et au même bord pour les trois viewers qui
 * l'accueillent. Ce fichier vérifie la pilule et son ancrage ; la page, qui la distribue aux
 * trois viewers, est vérifiée dans `test/pages/ReviewPage.test.tsx`.
 */
const shape: Shape = {
  id: 's1',
  type: 'arrow',
  color: '#ffffff',
  width: 3,
  x1: 0.2,
  y1: 0.2,
  x2: 0.6,
  y2: 0.6,
};

/** Composer réel, avec (ou sans) l'annotation d'un commentaire en lecture. */
function Host({ viewed, children }: { viewed: boolean; children: (ann: Annotations) => ReactNode }) {
  const ann = useAnnotations();
  const { setViewed } = ann;
  useEffect(() => {
    if (viewed) setViewed([shape]);
  }, [viewed, setViewed]);
  return <>{children(ann)}</>;
}

const pill = () => screen.getByRole('button', { name: t('ctx.hideAnnotation') });
const noPill = () => screen.queryByRole('button', { name: t('ctx.hideAnnotation') });

/** Zone média du viewer — la même poignée que pour les panes du partage client. */
const zone = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-viewer-zone]')!;

const pane3d = (exit: ReactNode) => (
  <Model3DThreePane
    status="READY"
    loadError={false}
    containerRef={{ current: null }}
    overlay={null}
    exit={exit}
    canReprocess={false}
    reprocessing={false}
    onReprocess={() => undefined}
  />
);

const paneSplat = (exit: ReactNode) => (
  <SplatPane
    containerRef={{ current: null }}
    ready
    loadError={false}
    progress={1}
    status="READY"
    overlay={null}
    exit={exit}
  />
);

describe('ReviewAnnotationBar — quitter la lecture d’un commentaire annoté', () => {
  it('ne flotte pas tant qu’aucune annotation n’est lue', () => {
    render(
      <Host viewed={false}>{(ann) => <ReviewAnnotationBar ann={ann} onClearSelection={vi.fn()} />}</Host>,
    );
    expect(noPill()).not.toBeInTheDocument();
  });

  it('rend la main à la rédaction : le clic relâche l’annotation et la pilule s’efface', () => {
    const onClear = vi.fn();
    render(
      <Host viewed>
        {(ann) => (
          <ReviewAnnotationBar
            ann={ann}
            onClearSelection={() => {
              onClear();
              ann.clearViewed();
            }}
            anchor="viewer"
          />
        )}
      </Host>,
    );
    fireEvent.click(pill());
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(noPill()).not.toBeInTheDocument();
  });

  it('Échap relâche l’annotation sans toucher la souris', () => {
    const onClear = vi.fn();
    render(
      <Host viewed>
        {(ann) => <ReviewAnnotationBar ann={ann} onClearSelection={onClear} anchor="viewer" />}
      </Host>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('ancrée au viewer, elle tient le bas du cadre — plus le haut, où passe l’en-tête', () => {
    render(
      <Host viewed>
        {(ann) => <ReviewAnnotationBar ann={ann} onClearSelection={vi.fn()} anchor="viewer" />}
      </Host>,
    );
    const holder = pill().parentElement!;
    expect(holder.className).toContain('bottom-3');
    expect(holder.className).not.toContain('top-2');
  });

  it('vit dans la zone média du viewer 3D', () => {
    const { container } = render(
      <Host viewed>
        {(ann) => pane3d(<ReviewAnnotationBar ann={ann} onClearSelection={vi.fn()} anchor="viewer" />)}
      </Host>,
    );
    expect(
      within(zone(container)).getByRole('button', { name: t('ctx.hideAnnotation') }),
    ).toBeInTheDocument();
  });

  it('vit dans la zone média du viewer splat, au même endroit', () => {
    const { container } = render(
      <Host viewed>
        {(ann) => paneSplat(<ReviewAnnotationBar ann={ann} onClearSelection={vi.fn()} anchor="viewer" />)}
      </Host>,
    );
    const holder = within(zone(container)).getByRole('button', {
      name: t('ctx.hideAnnotation'),
    }).parentElement!;
    expect(holder.className).toContain('bottom-3');
  });
});
