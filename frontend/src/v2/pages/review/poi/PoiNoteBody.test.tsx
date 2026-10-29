// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { stubLayoutMetrics } from '../../../../test/layoutMetrics';
import { t } from '../../../i18n';
import PoiNoteBody from './PoiNoteBody';

/**
 * What a point's remark must do, and what both surfaces did badly: wrap (never scroll sideways), show
 * only three lines, and place its thumbnail BESIDE the text. A remark unreadable in a 15 rem card is not a remark.
 *
 * Folding is MEASURED: these tests therefore set the width of the host surface, which happy-dom does not
 * provide. The two values come from a browser check: about forty characters per line in the comment
 * thread, about twenty in the anchored card, 15 rem wide.
 */

/** Characters per line in the comment thread: the wide surface. */
const THREAD_CHARS = 40;
/** Characters per line in the 15 rem anchored card: the narrow surface. */
const CARD_CHARS = 22;

/** A plan path: not a space, and much wider than a scene card. */
const longPath = '/mnt/prod/seq010/sh0420/comp/v012/sh0420_comp_v012_beauty_linear_exr_sequence';
const images = [
  { src: 'blob:defaut', alt: 'defaut.png' },
  { src: 'blob:autre', alt: 'autre.png' },
  { src: 'blob:troisieme', alt: 'troisieme.png' },
];

let restore: (() => void) | null = null;

const layout = (charsPerLine: number) => {
  restore?.();
  restore = stubLayoutMetrics({ charsPerLine });
};

afterEach(() => {
  restore?.();
  restore = null;
});

const expandButton = (text: string) =>
  screen.getByRole('button', { name: t('comments.expandComment', { count: text.length }) });

describe('PoiNoteBody — the remark reads without overflowing', () => {
  it('breaks an unbreakable word on the very element that carries the text', () => {
    layout(CARD_CHARS);
    const { container } = render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    const body = container.querySelector('.whitespace-pre-wrap');
    expect(body?.textContent).toBe(longPath);
    // The break must sit on the element THAT CONTAINS the text: placed on an ancestor, it lets the
    // child push the row out of the column.
    expect(container.querySelector('.break-words')).toBe(body);
    // And nothing above reopens a horizontal axis. These classes do exist in the repository: the folded
    // label of a scene card uses `truncate`. Using them here would bring back the scrolling the user does not want.
    const reopens = /(^|\s)(truncate|whitespace-nowrap|overflow-(x-)?(auto|scroll))(\s|$)/;
    for (const el of Array.from(container.querySelectorAll('*')))
      expect(el.getAttribute('class') ?? '').not.toMatch(reopens);
  });

  it('shows only three lines until one has scrolled', () => {
    layout(CARD_CHARS);
    const { container } = render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
    fireEvent.click(expandButton(longPath));
    expect(container.querySelector('.line-clamp-3')).toBeNull();
    // And it can be folded again: the card does not stay wide open over the scene.
    fireEvent.click(screen.getByRole('button', { name: t('comments.collapseComment') }));
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
  });

  it('keeps the whole remark in the document, folded or unfolded', () => {
    layout(CARD_CHARS);
    const { container } = render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    expect(container.querySelector('.line-clamp-3')?.textContent).toHaveLength(longPath.length);
  });

  it('leaves a short remark without a clickable indicator', () => {
    layout(CARD_CHARS);
    render(<PoiNoteBody text="la soudure" images={[]} onImage={vi.fn()} />);
    expect(screen.getByText('la soudure')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /**
   * The defect closed here: the indicator was decided by the character count, calibrated on the narrow
   * card, and therefore also appeared in the thread, three times wider, where the three lines already
   * showed everything. "Scroll 77 characters", one click, and nothing was revealed.
   */
  it('offers to scroll only where the remark really overflows', () => {
    layout(THREAD_CHARS);
    const thread = render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    thread.unmount();

    layout(CARD_CHARS);
    render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    expect(expandButton(longPath)).toBeInTheDocument();
  });

  it('places the thumbnail BESIDE the text, in the same row', () => {
    layout(THREAD_CHARS);
    render(<PoiNoteBody text="la soudure" images={images.slice(0, 1)} onImage={vi.fn()} />);
    const strip = screen.getByRole('img').closest('div');
    const row = strip?.parentElement;
    expect(row?.className).toContain('flex');
    // The text occupies the first child of the row, the thumbnails the second: beside, not below, and
    // `shrink-0` prevents them from being crushed by a long text.
    expect(row?.firstElementChild?.textContent).toContain('la soudure');
    expect(row?.firstElementChild).not.toBe(strip);
    expect(strip?.className).toContain('shrink-0');
  });

  it("opens the Lightbox on the clicked thumbnail, without replaying the card's selection", () => {
    layout(THREAD_CHARS);
    const onImage = vi.fn();
    const stop = vi.fn();
    render(<PoiNoteBody text="la soudure" images={images.slice(0, 1)} onImage={onImage} stop={stop} />);
    fireEvent.click(screen.getByRole('button', { name: t('comments.openAttachment') }));
    expect(onImage).toHaveBeenCalledWith(0);
    expect(stop).toHaveBeenCalled();
  });

  it('beyond one image, a tile opens the rest without eating the width', () => {
    layout(THREAD_CHARS);
    const onImage = vi.fn();
    render(<PoiNoteBody text="la soudure" images={images} onImage={onImage} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: t('comment.seeAllImages') }));
    expect(onImage).toHaveBeenCalledWith(1);
  });
});
