// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EntityThumb from './EntityThumb';

/**
 * The name fallback is the display rule for every element (project, sequence, shot, asset). What is
 * checked here is that it never takes precedence over a real thumbnail, and that it does not repeat the
 * title for a screen reader.
 */
describe('EntityThumb', () => {
  it('shows the name as long as no image exists', () => {
    const html = renderToStaticMarkup(<EntityThumb name="SH0120" />);
    expect(html).toContain('SH0120');
    expect(html).not.toContain('<img');
  });

  it('gives way to the thumbnail as soon as an image arrives', () => {
    const html = renderToStaticMarkup(<EntityThumb name="SH0120" url="https://minio/t.jpg" />);
    expect(html).toContain('src="https://minio/t.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    // The name no longer needs to be written: the image replaces it, and the title already carries it.
    expect(html).not.toContain('SH0120');
  });

  it('does not repeat the name to screen readers: the title already carries it', () => {
    expect(renderToStaticMarkup(<EntityThumb name="SH0120" />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<EntityThumb name="SH0120" url="https://minio/t.jpg" />)).toContain('alt=""');
  });

  it('abbreviates below 40 px, where the full name would not fit', () => {
    expect(renderToStaticMarkup(<EntityThumb name="Le Grand Voyage" variant="mini" />)).toContain('LG');
  });

  it('shrinks the font as the name gets longer', () => {
    expect(renderToStaticMarkup(<EntityThumb name="SQ010" />)).toContain('text-xl');
    expect(renderToStaticMarkup(<EntityThumb name="Le Grand Voyage de Mémé" />)).toContain('text-sm');
  });
});
