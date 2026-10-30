// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { stubLayoutMetrics } from '@/test/layoutMetrics';
import { t } from '@/v2/i18n';
import PoiCommentPoints from './PoiCommentPoints';
import type { PoiPoint } from './poiPoints';

/**
 * The comment thread is the WIDE surface: about forty characters per line, measured in a browser.
 * Whether a remark is folded is decided by what the three visible lines really hide, and happy-dom
 * lays nothing out, so we lend it that width.
 */
let restore: (() => void) | null = null;

beforeEach(() => {
  restore = stubLayoutMetrics({ charsPerLine: 40 });
});

afterEach(() => {
  restore?.();
  restore = null;
});

const points: PoiPoint[] = [
  { position: '0 0 0', normal: '0 0 1', space: 'object', text: 'la soudure', images: ['k1'] },
  { position: '1 0 0', normal: '0 0 1', space: 'object', text: 'le boulon' },
];

const attachments = [
  { key: 'k1', name: 'defaut.png', contentType: 'image/png', url: 'blob:defaut' },
  { key: 'k9', name: 'autre.png', contentType: 'image/png', url: 'blob:autre' },
];

describe('PoiCommentPoints — clicking a number brings the camera back to its point', () => {
  it('renders a numbered row per point, with its remark', () => {
    render(<PoiCommentPoints points={points} attachments={attachments} stop={() => undefined} />);
    expect(screen.getByText('la soudure')).toBeInTheDocument();
    expect(screen.getByText('le boulon')).toBeInTheDocument();
  });

  it('calls the camera return with the point and its rank', () => {
    const onFocus = vi.fn();
    render(
      <PoiCommentPoints points={points} attachments={attachments} onFocus={onFocus} stop={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('poi.focus', { n: 2 }) }));
    expect(onFocus).toHaveBeenCalledWith(points[1], 1);
  });

  it('without a viewer at hand, the numbers remain plain text', () => {
    render(<PoiCommentPoints points={points} attachments={attachments} stop={() => undefined} />);
    expect(screen.queryByRole('button', { name: t('poi.focus', { n: 1 }) })).not.toBeInTheDocument();
  });

  it('shows for a point only ITS images, recognised by their key', () => {
    render(<PoiCommentPoints points={points} attachments={attachments} stop={() => undefined} />);
    const thumbs = screen.getAllByRole('img');
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toHaveAttribute('alt', 'defaut.png');
  });

  it('folds a remark that is too long instead of scrolling it sideways', () => {
    // Long enough to exceed three lines IN THE THREAD: a remark that already fits there has nothing
    // to fold, and that is precisely what the character count ignored.
    const long =
      '/mnt/prod/seq010/sh0420/comp/v012/sh0420_comp_v012_beauty_linear_exr_sequence' +
      ' et la meme chose sur sh0430 ou la soudure ressort encore plus franchement au raccord';
    const { container } = render(
      <PoiCommentPoints
        points={[{ ...points[0], text: long }]}
        attachments={attachments}
        stop={() => undefined}
      />,
    );
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
    expect(container.querySelector('.break-words')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: t('comments.expandComment', { count: long.length }) }),
    );
    expect(container.querySelector('.line-clamp-3')).toBeNull();
  });

  it('places the point thumbnail beside its remark, not below', () => {
    render(<PoiCommentPoints points={points} attachments={attachments} stop={() => undefined} />);
    const strip = screen.getByRole('img').closest('div');
    expect(strip?.parentElement?.firstElementChild?.textContent).toContain('la soudure');
    expect(strip?.className).toContain('shrink-0');
  });

  it('renders nothing when the comment carries no point', () => {
    const { container } = render(<PoiCommentPoints points={[]} stop={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
