// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render as mountInDom, screen } from '@testing-library/react';
import ClientComments from './ClientComments';
import { stubLayoutMetrics } from '@/test/layoutMetrics';
import { t } from '../../i18n';
import type { ClientComment } from '../../types/api';

const comment = (patch: Partial<ClientComment> = {}): ClientComment => ({
  id: 1,
  content: 'Trop sombre',
  timestamp: 65,
  duration: null,
  guestName: 'Client',
  author: null,
  createdAt: '2026-08-21T10:00:00.000Z',
  isEdited: false,
  annotation: null,
  ...patch,
});

const wall = 'z'.repeat(700);

const element = (props: Partial<Parameters<typeof ClientComments>[0]> = {}) => (
  <ClientComments
    comments={[comment()]}
    canComment={false}
    timed
    fps={24}
    startFrame={1001}
    selectedId={null}
    hasAnnotation={false}
    guestName=""
    onGuestName={vi.fn()}
    onSelect={vi.fn()}
    onSeek={vi.fn()}
    onSubmit={vi.fn()}
    composerRef={createRef<HTMLTextAreaElement>()}
    {...props}
  />
);

const render = (props: Partial<Parameters<typeof ClientComments>[0]> = {}) =>
  renderToStaticMarkup(element(props));

/**
 * The client thread decides only two things, but they matter: a VIEW link must not
 * offer a composer, and a timestamp only makes sense on media that carries time.
 * Assertions target structure, never translated text.
 */
describe('ClientComments', () => {
  it('offers no composer on a read-only link', () => {
    const html = render({ canComment: false });
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<textarea');
  });

  it('opens the composer as soon as the link allows comments', () => {
    const html = render({ canComment: true });
    expect(html).toContain('<form');
    expect(html).toContain('<textarea');
  });

  it('makes the timestamp clickable on a video', () => {
    expect(render({ timed: true })).toContain('01:05');
  });

  it('shows no timestamp on media without a time axis', () => {
    expect(render({ timed: false })).not.toContain('01:05');
  });

  it('strips leftover markup from a comment instead of injecting it', () => {
    const html = render({ comments: [comment({ content: '<b>gras</b> et <script>x</script>' })] });
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('gras et x');
  });

  it('shows the empty state when the studio rendered no visible note', () => {
    const html = render({ comments: [] });
    expect(html).not.toContain('Trop sombre');
    expect(html).toContain('<p');
  });
});

/**
 * Drawing tools sit BELOW the comment field, where the internal review puts its own,
 * not above the image where they pushed away the media they annotate.
 */
describe('ClientComments — tools and drawing only', () => {
  it('places the toolbar in the composer, nowhere else', () => {
    const html = render({ canComment: true, annotationBar: <div data-testid="tools" /> });
    const form = html.slice(html.indexOf('<form'));
    expect(form).toContain('data-testid="tools"');
  });

  it('offers no tool on a read-only link', () => {
    expect(render({ canComment: false, annotationBar: <div data-testid="tools" /> })).not.toContain(
      'data-testid="tools"',
    );
  });

  /**
   * The server requires content, but a drawing counts as content: the send button must
   * enable on a drawing alone. Target the `disabled=""` attribute, not the word, which
   * also appears in utility classes (`disabled:opacity-50`) that are always present.
   */
  it('lets a drawing be sent without text, and rejects an empty submission', () => {
    expect(render({ canComment: true, hasAnnotation: true })).not.toContain('disabled=""');
    expect(render({ canComment: true, hasAnnotation: false })).toContain('disabled=""');
  });
});

/**
 * The portal showed NO attachments: an image attached by the studio arrived invisible
 * to its recipient. URLs are presigned server-side, so the MinIO key never leaves the
 * server and there is nothing to rebuild here.
 */
describe('ClientComments — studio attachments', () => {
  const withImage = () =>
    comment({
      attachments: [{ name: 'planche.png', contentType: 'image/png', url: 'https://minio/planche' }],
    });

  it('shows the thumbnail of an attached image', () => {
    const html = render({ comments: [withImage()] });
    expect(html).toContain('https://minio/planche');
    expect(html).toContain('planche.png');
  });

  it('adds no thumbnail to a note without an attachment', () => {
    expect(render()).not.toContain('<img');
  });
});

/**
 * An oversized note opens collapsed, but its text stays in the page, so it is findable.
 *
 * The indicator depends on what the column actually hides (cf. `CollapsibleText`), so it
 * only appears once the page is laid out, never in a flat markup dump. These two cases
 * run against a real DOM at a client share column width; the flat markup still best
 * proves that the full text is present.
 */
describe('ClientComments — oversized note', () => {
  const longNote = [comment({ content: wall, timestamp: null })];

  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });
  const layout = () => {
    restore = stubLayoutMetrics({ charsPerLine: 40 });
  };

  /**
   * The only exception to the file's rule: the indicator is located by its label, because
   * the comment row is itself a button, so counting buttons would tell us nothing.
   */
  const expandName = (text: string) => t('comments.expandComment', { count: text.length });

  it('shows an expand indicator and keeps the full text', () => {
    layout();
    mountInDom(element({ timed: false, comments: longNote }));
    expect(screen.getByText(wall)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: expandName(wall) })).toBeInTheDocument();
  });

  it('does not collapse a short note', () => {
    layout();
    const short = comment({ timestamp: null });
    mountInDom(element({ timed: false, comments: [short] }));
    expect(screen.queryByRole('button', { name: expandName(short.content) })).not.toBeInTheDocument();
  });

  it('keeps the full text out of any browser: nothing is truncated at the source', () => {
    expect(render({ timed: false, comments: longNote })).toContain(wall);
  });
});
