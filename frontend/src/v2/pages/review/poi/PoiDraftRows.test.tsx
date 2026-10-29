// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@/v2/i18n';
import PoiDraftRows from './PoiDraftRows';
import type { PoiDraft, PoiDraftState } from './usePoiDraft';

/**
 * The composer is the first place where a point's remark is seen: that is where it is typed. A
 * single-line field scrolled sideways by construction (never a line break, never three visible
 * lines), and its thumbnails went BELOW.
 *
 * So we verify what the user asked for, at writing time: a field that wraps, grows up to three lines,
 * then scrolls vertically, with its images beside it.
 */

/** Fallback line height of the primitive when `line-height` cannot be computed. */
const LINE = 20;

const point = (patch: Partial<PoiDraft> = {}): PoiDraft => ({
  key: 'p1',
  position: '0 0 0',
  normal: '0 0 1',
  space: 'object',
  text: '',
  files: [],
  ...patch,
});

const png = (name: string) => new File(['x'], name, { type: 'image/png' });

function draftState(points: PoiDraft[], patch: Partial<PoiDraftState> = {}): PoiDraftState {
  return {
    points,
    activeKey: null,
    setActiveKey: vi.fn(),
    add: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    setText: vi.fn(),
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    clear: vi.fn(),
    ...patch,
  };
}

/** The remark field of the point at rank `n`. */
const noteField = (n: number) => screen.getByLabelText(t('poi.noteFor', { n }));

/** Content height the browser would render: happy-dom lays nothing out. */
function pretendContent(el: HTMLElement, lines: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: lines * LINE });
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:apercu');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PoiDraftRows — write the remark as it will be read', () => {
  it('renders nothing as long as no point is placed', () => {
    const { container } = render(<PoiDraftRows poi={draftState([])} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a MULTI-LINE field, not a field that scrolls sideways', () => {
    render(<PoiDraftRows poi={draftState([point()])} />);
    const field = noteField(1);
    // An `input` never wraps: the field must be a textarea.
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveClass('break-words');
  });

  it('grows up to three lines, then scrolls vertically', () => {
    render(<PoiDraftRows poi={draftState([point({ text: 'la soudure' })])} />);
    const field = noteField(1);

    pretendContent(field, 2);
    fireEvent.input(field);
    expect(field.style.height).toBe(`${2 * LINE}px`);
    expect(field.style.overflowY).toBe('hidden');

    // Four lines of content: the row no longer grows, it is the field that scrolls.
    pretendContent(field, 4);
    fireEvent.input(field);
    expect(field.style.height).toBe(`${3 * LINE}px`);
    expect(field.style.overflowY).toBe('auto');
  });

  it("renders the remark typed into the point's draft, line breaks included", () => {
    const setText = vi.fn();
    render(<PoiDraftRows poi={draftState([point()], { setText })} />);
    fireEvent.change(noteField(1), { target: { value: 'la soudure\nressort au raccord' } });
    expect(setText).toHaveBeenCalledWith('p1', 'la soudure\nressort au raccord');
  });

  it('brings the point to the front as soon as one writes in it', () => {
    const setActiveKey = vi.fn();
    render(<PoiDraftRows poi={draftState([point()], { setActiveKey })} />);
    fireEvent.focus(noteField(1));
    expect(setActiveKey).toHaveBeenCalledWith('p1');
  });

  it('places the thumbnails BESIDE the field, in the same row', () => {
    render(<PoiDraftRows poi={draftState([point({ files: [png('defaut.png')] })])} />);
    const field = noteField(1);
    const strip = screen.getByRole('list', { name: t('comments.attachmentsList') });
    // Same row: the thumbnail strip is a sibling of the field, not a block below the row.
    expect(strip.parentElement?.parentElement).toBe(field.parentElement);
    expect(strip.parentElement?.className).toContain('shrink-0');
    expect(screen.getByRole('img', { name: 'defaut.png' })).toHaveAttribute('src', 'blob:apercu');
  });

  it('removes the designated image from the right point', () => {
    const removeFile = vi.fn();
    render(
      <PoiDraftRows poi={draftState([point({ files: [png('a.png'), png('b.png')] })], { removeFile })} />,
    );
    const crosses = screen.getAllByRole('button', { name: t('comments.removeAttachment') });
    fireEvent.click(crosses[1]);
    expect(removeFile).toHaveBeenCalledWith('p1', 1);
  });

  it('deletes the point with a cross', () => {
    const remove = vi.fn();
    render(<PoiDraftRows poi={draftState([point()], { remove })} />);
    fireEvent.click(screen.getByRole('button', { name: t('poi.removePoint') }));
    expect(remove).toHaveBeenCalledWith('p1');
  });

  it('numbers the rows in the order they were placed', () => {
    render(<PoiDraftRows poi={draftState([point(), point({ key: 'p2' })])} />);
    expect(noteField(1)).toBeInTheDocument();
    expect(noteField(2)).toBeInTheDocument();
  });
});
