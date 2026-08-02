// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  isAllowedAttachment,
  isAudioAttachment,
  isImageAttachment,
  MAX_COMMENT_ATTACHMENTS,
} from './commentAttachments';

describe('pièces jointes de commentaire — types acceptés', () => {
  it('accepte les images du whitelist', () => {
    expect(isAllowedAttachment('image/png')).toBe(true);
    expect(isAllowedAttachment('image/jpeg')).toBe(true);
    expect(isAllowedAttachment('image/webp')).toBe(true);
    expect(isAllowedAttachment('image/gif')).toBe(true);
  });

  it('accepte PDF, zip et texte (backlog P2 annotations avancées)', () => {
    expect(isAllowedAttachment('application/pdf')).toBe(true);
    expect(isAllowedAttachment('application/zip')).toBe(true);
    expect(isAllowedAttachment('text/plain')).toBe(true);
  });

  it('accepte les notes vocales (32.F), avec ou sans codecs', () => {
    expect(isAllowedAttachment('audio/webm')).toBe(true);
    expect(isAllowedAttachment('audio/webm;codecs=opus')).toBe(true);
    expect(isAllowedAttachment('audio/ogg')).toBe(true);
    expect(isAllowedAttachment('audio/flac')).toBe(false);
    expect(isAudioAttachment('audio/webm')).toBe(true);
    expect(isAudioAttachment('image/png')).toBe(false);
    expect(isAudioAttachment(undefined)).toBe(false);
  });

  it('refuse les autres types', () => {
    expect(isAllowedAttachment('image/svg+xml')).toBe(false);
    expect(isAllowedAttachment('application/octet-stream')).toBe(false);
    expect(isAllowedAttachment('video/mp4')).toBe(false);
    expect(isAllowedAttachment('')).toBe(false);
  });

  it('distingue vignette image et chip fichier', () => {
    expect(isImageAttachment('image/png')).toBe(true);
    expect(isImageAttachment('application/pdf')).toBe(false);
    expect(isImageAttachment(undefined)).toBe(false);
  });

  it('plafonne à 8 pièces jointes par commentaire (miroir du Zod backend)', () => {
    expect(MAX_COMMENT_ATTACHMENTS).toBe(8);
  });
});
