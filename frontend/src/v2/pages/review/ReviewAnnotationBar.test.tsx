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
 * The exit of an annotated comment playback used to sit in the review section, whose first
 * child is the chrome header: it therefore landed on the mode toggle, also centered. It now
 * lives INSIDE the media area — at the same edge for the three viewers that host it. This
 * file checks the pill and its anchoring; the page, which distributes it to the three
 * viewers, is checked in `test/pages/ReviewPage.test.tsx`.
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

/** Real composer, with (or without) the annotation of a comment being played back. */
function Host({
  viewed,
  poi,
  children,
}: {
  viewed: boolean;
  /** The reviewed comment only shows its points of interest — no 2D drawing. */
  poi?: boolean;
  children: (ann: Annotations) => ReactNode;
}) {
  const ann = useAnnotations();
  const { setViewed, setViewedPoi } = ann;
  useEffect(() => {
    if (viewed) setViewed([shape]);
    if (poi) setViewedPoi([{ position: '0 0 0', normal: '0 0 1', space: 'object' }]);
  }, [viewed, poi, setViewed, setViewedPoi]);
  return <>{children(ann)}</>;
}

const pill = () => screen.getByRole('button', { name: t('ctx.hideAnnotation') });
const noPill = () => screen.queryByRole('button', { name: t('ctx.hideAnnotation') });

/** Viewer media area — the same handle as for the client share panes. */
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

describe('ReviewAnnotationBar — leaving the playback of an annotated comment', () => {
  it('does not float while no annotation is being played', () => {
    render(
      <Host viewed={false}>{(ann) => <ReviewAnnotationBar ann={ann} onClearSelection={vi.fn()} />}</Host>,
    );
    expect(noPill()).not.toBeInTheDocument();
  });

  it('stays offered when the comment only shows its points of interest', () => {
    // Points survive view movement (they are anchored in the scene): they are therefore what
    // stays on screen the longest, and without them playback would have no exit.
    render(
      <Host viewed={false} poi>
        {(ann) => <ReviewAnnotationBar ann={ann} onClearSelection={vi.fn()} anchor="viewer" />}
      </Host>,
    );
    expect(pill()).toBeInTheDocument();
  });

  it('hands control back to the composer: the click releases the annotation and the pill fades', () => {
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

  it('Escape releases the annotation without touching the mouse', () => {
    const onClear = vi.fn();
    render(
      <Host viewed>
        {(ann) => <ReviewAnnotationBar ann={ann} onClearSelection={onClear} anchor="viewer" />}
      </Host>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('anchored to the viewer, it holds the bottom of the frame — not the top, where the header runs', () => {
    render(
      <Host viewed>
        {(ann) => <ReviewAnnotationBar ann={ann} onClearSelection={vi.fn()} anchor="viewer" />}
      </Host>,
    );
    const holder = pill().parentElement!;
    expect(holder.className).toContain('bottom-3');
    expect(holder.className).not.toContain('top-2');
  });

  it('lives in the media area of the 3D viewer', () => {
    const { container } = render(
      <Host viewed>
        {(ann) => pane3d(<ReviewAnnotationBar ann={ann} onClearSelection={vi.fn()} anchor="viewer" />)}
      </Host>,
    );
    expect(
      within(zone(container)).getByRole('button', { name: t('ctx.hideAnnotation') }),
    ).toBeInTheDocument();
  });

  it('lives in the media area of the splat viewer, in the same place', () => {
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
