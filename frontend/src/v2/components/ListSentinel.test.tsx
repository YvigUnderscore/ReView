// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ListSentinel, { ListCount } from './ListSentinel';

/**
 * What the list must say about itself: how many rows out of how many, and whether more
 * remains. That is exactly what was missing: a hundred shots out of twelve hundred, without a word.
 *
 * The assertions target the chosen branch, never the translated text: the
 * catalog can change its wording without invalidating the behaviour checked here.
 */
describe('ListCount', () => {
  it('does not show the full-list label while the list is truncated', () => {
    const html = renderToStaticMarkup(<ListCount loaded={100} total={1247} label="1,247 media" />);
    expect(html).not.toContain('1,247 media');
    expect(html).toContain('<p');
  });

  it('renders the full label once everything is loaded', () => {
    expect(renderToStaticMarkup(<ListCount loaded={12} total={12} label="12 media" />)).toContain('12 media');
  });

  it('keeps a counter when no full label is provided', () => {
    expect(renderToStaticMarkup(<ListCount loaded={12} total={12} />)).toContain('<p');
  });

  it('says nothing about an empty list: the empty state handles it', () => {
    expect(renderToStaticMarkup(<ListCount loaded={0} total={0} />)).toBe('');
  });
});

describe('ListSentinel', () => {
  it('takes up no space when the list is complete', () => {
    const html = renderToStaticMarkup(
      <ListSentinel hasMore={false} isLoading={false} onLoadMore={() => {}} />,
    );
    expect(html).toBe('');
  });

  it('offers an explicit command while pages remain', () => {
    const html = renderToStaticMarkup(<ListSentinel hasMore isLoading={false} onLoadMore={() => {}} />);
    expect(html).toContain('<button');
    expect(html).not.toContain('disabled=""');
  });

  it('locks the command during loading: two clicks, a single page', () => {
    const html = renderToStaticMarkup(<ListSentinel hasMore isLoading onLoadMore={() => {}} />);
    expect(html).toContain('disabled=""');
  });
});
