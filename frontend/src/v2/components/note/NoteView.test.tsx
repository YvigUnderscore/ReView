// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NoteView from './NoteView';
import { renderNoteHtml } from './noteRender';

/**
 * How a note renders.
 *
 * `parseNote` is tested separately; what is at stake here is what the reader sees, and above all what they must
 * never see: raw HTML coming from a copy-paste.
 */
describe('NoteView', () => {
  it('renders nothing for an empty note', () => {
    expect(renderToStaticMarkup(<NoteView source="" />)).toBe('');
  });

  it('renders an accessible gauge, with its value', () => {
    const html = renderToStaticMarkup(<NoteView source="::progress Animation 60" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toContain('Animation');
    expect(html).toContain('60%');
  });

  it('collapses a section marked as such, and does not render its content', () => {
    const open = renderToStaticMarkup(<NoteView source={'## Brief\nle texte'} />);
    const closed = renderToStaticMarkup(<NoteView source={'##- Brief\nle texte'} />);
    expect(open).toContain('le texte');
    expect(closed).not.toContain('le texte');
    expect(closed).toContain('aria-expanded="false"');
  });

  it('shows the carousel with its counter', () => {
    const html = renderToStaticMarkup(<NoteView source={'::refs\n![Une](a.jpg)\n![Deux](b.jpg)\n::end'} />);
    expect(html).toContain('src="a.jpg"');
    expect(html).toContain('1 / 2');
  });

  it('lays out a board: all the images at once, at the requested height', () => {
    const html = renderToStaticMarkup(
      <NoteView source={'::refs grid cols=2 h=120\n![Une](a.jpg)\n![Deux](b.jpg)\n::end'} />,
    );
    expect(html).toContain('src="a.jpg"');
    expect(html).toContain('src="b.jpg"');
    // The board shows everything: no counter, there is nothing to flip through.
    expect(html).not.toContain('1 / 2');
    expect(html).toContain('height:120px');
  });
});

describe('renderNoteHtml — image layout', () => {
  it('takes the layout from the markdown title so it is not left as a tooltip', () => {
    const html = renderNoteHtml('![ref](a.jpg "align=left width=40")');
    expect(html).toContain('data-align="left"');
    expect(html).toContain('width:40%');
    expect(html).not.toContain('title=');
  });

  it('leaves full width to whatever asked for nothing', () => {
    const html = renderNoteHtml('![ref](a.jpg)');
    expect(html).toContain('data-align="full"');
    expect(html).not.toContain('style=');
  });
});

describe('renderNoteHtml — note images', () => {
  const KEY = 'note-images/shot/12/1700-planche.png';

  it('replaces the stored key with the read URL', () => {
    const html = renderNoteHtml(`![ref](${KEY})`, (src) =>
      src === KEY ? 'https://minio/signed' : undefined,
    );
    expect(html).toContain('src="https://minio/signed"');
  });

  it('shows a frame while the URL is not there: never a broken image', () => {
    const html = renderNoteHtml(`![ref](${KEY})`);
    expect(html).not.toContain('<img');
    expect(html).toContain('data-note-image-pending');
  });

  it('waits for no resolution for an image left outside', () => {
    expect(renderNoteHtml('![ref](https://studio.test/a.jpg)')).toContain('src="https://studio.test/a.jpg"');
  });
});

describe('renderNoteHtml — guard rails', () => {
  it('escapes raw HTML: the server only stores text', () => {
    const html = renderNoteHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('removes a link with an executable protocol, without losing the text', () => {
    const html = renderNoteHtml('[clic](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('clic');
  });

  it('opens external links alongside, without delivering the address of the instance', () => {
    const html = renderNoteHtml('[doc](https://studio.test/brief)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('removes an image with an executable protocol', () => {
    expect(renderNoteHtml('![x](javascript:alert(1))')).not.toContain('<img');
  });

  it('loads images lazily: a brief can carry a whole board of them', () => {
    const html = renderNoteHtml('![ref](https://studio.test/a.jpg)');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});
