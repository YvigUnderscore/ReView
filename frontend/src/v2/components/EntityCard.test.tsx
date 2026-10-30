// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import EntityCard, { EntityContainer, type EntityCardProps } from './EntityCard';

/**
 * `EntityCard` is the card of all dense lists (shots, assets, projects). A hundred
 * shots meant a hundred 640 px JPEGs requested in parallel as soon as the grid mounted, for a
 * dozen visible cards. Lazy loading is therefore an attribute not to lose
 * during redesigns, and it must not change what the card displays.
 */
const markup = (props: Partial<EntityCardProps> = {}) =>
  renderToStaticMarkup(<EntityCard title="SH010" view="cards" {...props} />);

describe('EntityCard — vignette', () => {
  it('loads the card-view image lazily and decodes it off the main thread', () => {
    const html = markup({ thumbnailUrl: 'https://minio/thumb.jpg' });
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('src="https://minio/thumb.jpg"');
  });

  it('does the same in compact view', () => {
    const html = markup({ view: 'compact', thumbnailUrl: 'https://minio/thumb.jpg' });
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it('shows the name in place of the image while no thumbnail is known', () => {
    // A grey image icon repeated a hundred times distinguished nothing: on a grid of
    // fresh shots, only the name says what one is looking at.
    const cards = markup();
    expect(cards).not.toContain('<img');
    // Twice: in the tile and in the title. The tile is hidden from the screen reader.
    expect(cards.match(/SH010/g)).toHaveLength(2);
    expect(cards).toContain('aria-hidden="true"');

    // Compact view: 32 px square, where only the abbreviation fits.
    const compact = markup({ view: 'compact' });
    expect(compact).not.toContain('<img');
    expect(compact).toContain('>010<');
  });

  it('always shows title, subtitle and badge', () => {
    const html = markup({
      subtitle: 'seq_010',
      badge: <span>WIP</span>,
      thumbnailUrl: 'https://minio/thumb.jpg',
    });
    expect(html).toContain('SH010');
    expect(html).toContain('seq_010');
    expect(html).toContain('WIP');
  });

  it('renders an image with empty alternative text: the title already carries the information', () => {
    // `alt=""` is deliberate (a decorative image doubled by the title): checking it prevents
    // a future redesign from turning it into a duplicate read by the screen reader.
    expect(markup({ thumbnailUrl: 'https://minio/thumb.jpg' })).toContain('alt=""');
  });
});

/**
 * The information strip: what a card says about an entity beyond its name.
 *
 * It was added to answer at a glance the four questions one asks while
 * scanning a grid of two hundred shots. Two invariants hold it: it only shows
 * if it has something to say, and it says the same thing in both views.
 */
describe('EntityCard — information strip', () => {
  const alice = {
    id: 2,
    name: 'Alice Martin',
    firstName: 'Alice',
    lastName: 'Martin',
    username: null,
    avatarUrl: null,
  };

  it('shows the description, the faces and the waiting dot', () => {
    const html = markup({
      meta: { description: 'Le héros entre par la gauche', assignees: [alice], awaitingReview: 3 },
    });
    expect(html).toContain('Le héros entre par la gauche');
    // No avatar uploaded: the initials badge stands in for a face.
    expect(html).toContain('AM');
    expect(html).toContain('>3<');
  });

  it('reserves no height when there is nothing to say', () => {
    // An empty strip on a new card would cost the density of the whole grid.
    const withMeta = markup({ meta: {} });
    const without = markup({});
    expect(withMeta).toBe(without);
  });

  it('hides the waiting dot at zero: "nothing to look at" is not information', () => {
    expect(markup({ meta: { awaitingReview: 0, assignees: [alice] } })).not.toContain('>0<');
  });

  it('says the same thing in compact view', () => {
    const html = markup({ view: 'compact', meta: { description: 'Brief du plan', assignees: [alice] } });
    expect(html).toContain('Brief du plan');
    expect(html).toContain('AM');
  });

  it('limits the description to two lines in card view, one line in compact', () => {
    expect(markup({ meta: { description: 'x' } })).toContain('line-clamp-2');
    expect(markup({ view: 'compact', meta: { description: 'x' } })).toContain('truncate');
  });
});

/**
 * The grid and its entrance wrappers.
 *
 * The wrappers were keyed by **index**: filtering a shot grid re-associated
 * each card with its neighbour's wrapper. React reused the adjacent node and
 * replayed the fade-in on cards already on screen (the list "flickered"). The
 * quantity measured here is therefore a **number of cards re-associated to another node**:
 * one before the fix, zero after.
 */
describe('EntityContainer — cascading entrance', () => {
  const grid = (codes: string[]) => (
    <EntityContainer view="cards">
      {codes.map((code) => (
        <EntityCard key={code} view="cards" title={code} thumbnailUrl="https://minio/t.jpg" />
      ))}
    </EntityContainer>
  );

  /** Wrappers of the grid, in DOM order. */
  const wrappers = (container: HTMLElement) => [...(container.firstElementChild?.children ?? [])];

  it('gives each card its own node when the list is filtered', () => {
    const { container, rerender } = render(grid(['SH010', 'SH020', 'SH030']));
    expect(wrappers(container)).toHaveLength(3);
    const kept = screen.getByText('SH020');

    rerender(grid(['SH020', 'SH030']));

    expect(screen.getByText('SH020')).toBe(kept);
    expect(screen.queryByText('SH010')).not.toBeInTheDocument();
  });

  it('animates in CSS, respecting "reduced motion" without JS', () => {
    const { container } = render(grid(['SH010', 'SH020']));

    for (const wrapper of wrappers(container)) {
      expect(wrapper).toHaveClass('animate-in');
      expect(wrapper).toHaveClass('motion-reduce:animate-none');
      // Without `fill-mode-backwards`, the card would be visible during its delay, then
      // would vanish at once to reappear: a flicker, not an entrance.
      expect(wrapper).toHaveClass('fill-mode-backwards');
    }
  });

  it('spreads the entrance, but caps the delay: a page of a hundred cards does not wait too long', () => {
    const { container } = render(grid(Array.from({ length: 40 }, (_, i) => `SH${i}`)));
    const delays = wrappers(container).map((w) => (w as HTMLElement).style.animationDelay);

    expect(delays.slice(0, 3)).toEqual(['0ms', '30ms', '60ms']);
    expect(Math.max(...delays.map((d) => Number.parseInt(d, 10)))).toBeLessThanOrEqual(360);
  });

  it('stacks without a wrapper in compact view', () => {
    const { container } = render(
      <EntityContainer view="compact">
        <EntityCard view="compact" title="SH010" thumbnailUrl="https://minio/t.jpg" />
      </EntityContainer>,
    );
    expect(container.querySelector('.animate-in')).toBeNull();
  });
});
