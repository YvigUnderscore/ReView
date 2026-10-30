// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EntityCard, { type EntityCardProps } from '../EntityCard';

/**
 * The "unseen" glow (Phase 50, batch 9).
 *
 * What these tests lock down is not the appearance but the **hierarchy**: the colour of the glow (`info`)
 * must never be confused with that of the selection (`primary`), and the selection must win. A checked card
 * that read as "new" would suggest a state that was not chosen, and worse, a lit card that read as checked
 * would expose a bulk action on what one believed was deselected.
 */
const markup = (props: Partial<EntityCardProps> = {}) =>
  renderToStaticMarkup(<EntityCard title="SH010" view="cards" {...props} />);

describe('EntityCard — "unseen" glow', () => {
  it('off by default: the border stays that of all the cards', () => {
    const html = markup({ meta: { updatedAt: '2026-02-01T00:00:00.000Z' } });
    expect(html).toContain('border-border');
    expect(html).not.toContain('border-info');
  });

  it('when lit, the card takes the `info` token, never `primary`', () => {
    const html = markup({ meta: { unseen: true, updatedAt: '2026-02-01T00:00:00.000Z' } });
    expect(html).toContain('border-info');
    expect(html).toContain('ring-info/40');
    // The leading space is what tells the resting border apart from the hover variant: every card
    // carries `hover:border-primary`, which is fine, since hover is transient feedback, not an entity state.
    expect(html).not.toContain(' border-primary');
  });

  it('selection wins: a checked card reads as checked', () => {
    const html = markup({
      meta: { unseen: true },
      selection: { selected: true, onSelect: () => {} },
    });
    expect(html).toContain('border-primary');
    expect(html).not.toContain('border-info');
  });

  it('in compact view too: the row is the card', () => {
    const html = markup({ view: 'compact', meta: { unseen: true } });
    expect(html).toContain('border-info');
  });

  it('the strip shows for "unseen" alone, on an otherwise empty card', () => {
    // Without this, a new entity (no assignee, no step, no date) would have had nowhere to place its
    // dot: `EntityCardMeta` stayed silent for lack of content.
    const bare = markup({ meta: {} });
    const lit = markup({ meta: { unseen: true } });
    expect(bare).not.toContain('bg-info');
    expect(lit).toContain('bg-info');
  });
});
