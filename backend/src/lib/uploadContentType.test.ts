// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { safeUploadContentType, isActiveContentType, OPAQUE_CONTENT_TYPE } from './uploadContentType';

describe('safeUploadContentType', () => {
  it('laisse passer les types rendus en ligne par l’UI', () => {
    for (const t of ['image/png', 'image/jpeg', 'video/mp4', 'audio/mpeg', 'application/pdf'])
      expect(safeUploadContentType(t)).toBe(t);
  });

  it('normalise la casse et retire les paramètres', () => {
    expect(safeUploadContentType('IMAGE/PNG')).toBe('image/png');
    expect(safeUploadContentType('text/plain; charset=utf-8')).toBe('text/plain');
    expect(safeUploadContentType('  image/webp  ')).toBe('image/webp');
  });

  // Le cœur du correctif : les objets sont servis depuis l'origine de l'app (nginx expose
  // MinIO sous /<bucket>/), un type actif y exécuterait du script avec le jeton de session.
  it('neutralise tout type interprété activement par le navigateur', () => {
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

  it('rend opaques les formats VFX inconnus du navigateur plutôt que de les refuser', () => {
    for (const t of ['image/x-exr', 'application/vnd.usd', 'application/x-alembic', 'video/x-red-r3d'])
      expect(safeUploadContentType(t)).toBe(OPAQUE_CONTENT_TYPE);
  });

  it('retombe sur le type opaque quand rien n’est déclaré', () => {
    expect(safeUploadContentType(undefined)).toBe(OPAQUE_CONTENT_TYPE);
    expect(safeUploadContentType(null)).toBe(OPAQUE_CONTENT_TYPE);
    expect(safeUploadContentType('')).toBe(OPAQUE_CONTENT_TYPE);
  });
});

describe('isActiveContentType', () => {
  it('reconnaît les types à risque, y compris les variantes +xml', () => {
    expect(isActiveContentType('text/html')).toBe(true);
    expect(isActiveContentType('image/svg+xml')).toBe(true);
    expect(isActiveContentType('application/rdf+xml')).toBe(true);
    expect(isActiveContentType('application/javascript')).toBe(true);
  });

  it('ne signale pas les médias inertes', () => {
    expect(isActiveContentType('image/png')).toBe(false);
    expect(isActiveContentType('application/pdf')).toBe(false);
    expect(isActiveContentType(undefined)).toBe(false);
  });
});
