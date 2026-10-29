// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { safeUploadContentType, isActiveContentType, OPAQUE_CONTENT_TYPE } from './uploadContentType';

describe('safeUploadContentType', () => {
  it('lets through the types rendered inline by the UI', () => {
    for (const t of ['image/png', 'image/jpeg', 'video/mp4', 'audio/mpeg', 'application/pdf'])
      expect(safeUploadContentType(t)).toBe(t);
  });

  it('normalizes the case and strips the parameters', () => {
    expect(safeUploadContentType('IMAGE/PNG')).toBe('image/png');
    expect(safeUploadContentType('text/plain; charset=utf-8')).toBe('text/plain');
    expect(safeUploadContentType('  image/webp  ')).toBe('image/webp');
  });

  // The core of the fix: objects are served from the app's origin (nginx exposes MinIO under
  // /<bucket>/), so an active type would run script there with the session token.
  it('neutralizes any type actively interpreted by the browser', () => {
    for (const t of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/xml',
      'application/javascript',
      'text/html; charset=utf-8',
      'TEXT/HTML',
    ])
      expect(safeUploadContentType(t)).toBe(OPAQUE_CONTENT_TYPE);
  });

  it('makes VFX formats unknown to the browser opaque rather than rejecting them', () => {
    for (const t of ['image/x-exr', 'application/vnd.usd', 'application/x-alembic', 'video/x-red-r3d'])
      expect(safeUploadContentType(t)).toBe(OPAQUE_CONTENT_TYPE);
  });

  it('falls back to the opaque type when nothing is declared', () => {
    expect(safeUploadContentType(undefined)).toBe(OPAQUE_CONTENT_TYPE);
    expect(safeUploadContentType(null)).toBe(OPAQUE_CONTENT_TYPE);
    expect(safeUploadContentType('')).toBe(OPAQUE_CONTENT_TYPE);
  });
});

describe('isActiveContentType', () => {
  it('recognizes risky types, including the +xml variants', () => {
    expect(isActiveContentType('text/html')).toBe(true);
    expect(isActiveContentType('image/svg+xml')).toBe(true);
    expect(isActiveContentType('application/rdf+xml')).toBe(true);
    expect(isActiveContentType('application/javascript')).toBe(true);
  });

  it('does not flag inert media', () => {
    expect(isActiveContentType('image/png')).toBe(false);
    expect(isActiveContentType('application/pdf')).toBe(false);
    expect(isActiveContentType(undefined)).toBe(false);
  });
});
