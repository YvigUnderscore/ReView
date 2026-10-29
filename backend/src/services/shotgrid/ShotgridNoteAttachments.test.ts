// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../StorageService', () => ({ storage: {} }));

import { asRefs, guessType, sanitize, storedContentType } from './ShotgridNoteAttachments';

/**
 * The `Content-Type` comes from the ShotGrid site: it is no more reliable than a browser's. The attachment is served from the application's origin:
 * a `text/html` would run script there with the reader's session.
 */
describe('storedContentType', () => {
  it('refuses the active types announced by the remote site', () => {
    expect(storedContentType('text/html', 'note.html')).toBe('application/octet-stream');
    expect(storedContentType('image/svg+xml', 'annot.svg')).toBe('application/octet-stream');
    expect(storedContentType('text/html; charset=utf-8', 'note.htm')).toBe('application/octet-stream');
  });

  it('keeps the announced type when it can be rendered safely', () => {
    expect(storedContentType('image/png', 'annot.png')).toBe('image/png');
    expect(storedContentType('application/pdf', 'brief.pdf')).toBe('application/pdf');
  });

  it('falls back to the file name when the transport stays generic', () => {
    expect(storedContentType('application/octet-stream', 'annot.png')).toBe('image/png');
    expect(storedContentType(undefined, 'frame.jpg')).toBe('image/jpeg');
    expect(storedContentType(null, 'rendu.exr')).toBe('application/octet-stream');
  });

  it('is not fooled by an active extension', () => {
        // Misleading extension and silent transport: `guessType` does not know `.svg`, but the allowlist remains the last word.
    expect(storedContentType(undefined, 'annot.svg')).toBe('application/octet-stream');
  });
});

describe('guessType', () => {
  it("gives an image type, otherwise the attachment has no thumbnail", () => {
        // The thread only shows the preview if the type starts with `image/`: an image filed as `application/octet-stream` becomes a file line to download,
        // and the annotation coming from ShotGrid becomes invisible again.
    expect(guessType('annot.png')).toBe('image/png');
    expect(guessType('ANNOT.PNG')).toBe('image/png');
    expect(guessType('frame.jpeg')).toBe('image/jpeg');
    expect(guessType('frame.jpg')).toBe('image/jpeg');
    expect(guessType('capture.webp')).toBe('image/webp');
  });

  it('recognizes the other common attachments', () => {
    expect(guessType('brief.pdf')).toBe('application/pdf');
  });

  it("does not invent a type for what it does not know", () => {
    expect(guessType('rendu.exr')).toBe('application/octet-stream');
    expect(guessType('sans-extension')).toBe('application/octet-stream');
  });
});

describe('asRefs', () => {
  it('keeps the attachments', () => {
    expect(
      asRefs([
        { id: 12, type: 'Attachment' },
        { id: 13, type: 'Attachment' },
      ]),
    ).toHaveLength(2);
  });

  it("discards what is not an attachment", () => {
        // `attachments` may hold something else depending on the site; looking up a Version through the Attachment endpoint would return nothing useful.
    expect(asRefs([{ id: 1, type: 'Version' }, { id: 2, type: 'Attachment' }, null])).toEqual([
      { id: 2, type: 'Attachment' },
    ]);
  });

  it('supports a note without attachment', () => {
    expect(asRefs(undefined)).toEqual([]);
    expect(asRefs(null)).toEqual([]);
    expect(asRefs('cassé')).toEqual([]);
  });
});

describe('sanitize', () => {
  it('returns a file name that can be placed in a storage key', () => {
    expect(sanitize('Capture d’écran 2026.png')).toBe('Capture_d_cran_2026.png');
  });

  it('prevents any path traversal', () => {
        // The key is then used to sign a read URL: letting "../" through there would designate another project's media.
    const sale = sanitize('../../media/42/source.exr');
    expect(sale).not.toContain('..');
    expect(sale).not.toContain('/');
  });

  it('bounds the length while keeping the end, hence the extension', () => {
    const long = sanitize(`${'a'.repeat(200)}.png`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('.png')).toBe(true);
  });
});
