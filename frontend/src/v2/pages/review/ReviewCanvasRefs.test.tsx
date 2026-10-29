// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import ReviewCanvasRefs from './ReviewCanvasRefs';
import { useAnnotations } from './useAnnotations';
import { t } from '../../i18n';
import type { ReviewReferenceItem } from './reviewTypes';

/**
 * Pasting used to place references at x = 1.05 and the position went into the database as is:
 * references outside any band, hence invisible, already exist. A reference can now be placed
 * anywhere on the canvas, and display only moves it when it would show nothing — here no band
 * is measurable (happy-dom measures nothing), so the visible area shrinks to the media frame
 * and the old position must be pulled back into it.
 */
const ref = (over: Partial<ReviewReferenceItem> = {}): ReviewReferenceItem => ({
  id: 1,
  url: 'https://example.invalid/ref.png',
  x: 1.05,
  y: 0,
  width: 0.3,
  commentId: null,
  ...over,
});

function Host({ references }: { references: ReviewReferenceItem[] }) {
  const ann = useAnnotations();
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ReviewCanvasRefs
        mediaId={7}
        references={references}
        selectedCommentId={null}
        canManage={false}
        ann={ann}
      />
    </QueryClientProvider>
  );
}

describe('persisted references', () => {
  it('reframes at display time a saved position outside the frame', () => {
    render(<Host references={[ref()]} />);
    const box = screen.getByAltText(t('ref.title')).parentElement!;
    expect(box.style.left).toBe('70%');
    expect(box.style.width).toBe('30%');
  });

  it('leaves in place a position already inside the frame', () => {
    render(<Host references={[ref({ x: 0.25, y: 0.5 })]} />);
    const box = screen.getByAltText(t('ref.title')).parentElement!;
    expect(box.style.left).toBe('25%');
    expect(box.style.top).toBe('50%');
  });

  it('also pulls back an inherited out-of-range vertical position', () => {
    render(<Host references={[ref({ x: 0.2, y: -2.5 })]} />);
    const box = screen.getByAltText(t('ref.title')).parentElement!;
    expect(box.style.left).toBe('20%');
    expect(box.style.top).toBe('0%');
  });

  it('does not show the reference of a comment that is not selected', () => {
    render(<Host references={[ref({ commentId: 42 })]} />);
    expect(screen.queryByAltText(t('ref.title'))).toBeNull();
  });
});
