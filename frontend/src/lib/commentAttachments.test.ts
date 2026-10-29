// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  isAllowedAttachment,
  isAudioAttachment,
  isImageAttachment,
  MAX_COMMENT_ATTACHMENTS,
} from './commentAttachments';

describe('comment attachments — accepted types', () => {
  it('accepts whitelisted images', () => {
    expect(isAllowedAttachment('image/png')).toBe(true);
    expect(isAllowedAttachment('image/jpeg')).toBe(true);
    expect(isAllowedAttachment('image/webp')).toBe(true);
    expect(isAllowedAttachment('image/gif')).toBe(true);
  });

  it('accepts PDF, zip and text (advanced annotations backlog P2)', () => {
    expect(isAllowedAttachment('application/pdf')).toBe(true);
    expect(isAllowedAttachment('application/zip')).toBe(true);
    expect(isAllowedAttachment('text/plain')).toBe(true);
  });

  it('accepts voice notes (32.F), with or without codecs', () => {
    expect(isAllowedAttachment('audio/webm')).toBe(true);
    expect(isAllowedAttachment('audio/webm;codecs=opus')).toBe(true);
    expect(isAllowedAttachment('audio/ogg')).toBe(true);
    expect(isAllowedAttachment('audio/flac')).toBe(false);
    expect(isAudioAttachment('audio/webm')).toBe(true);
    expect(isAudioAttachment('image/png')).toBe(false);
    expect(isAudioAttachment(undefined)).toBe(false);
  });

  it('refuses other types', () => {
    expect(isAllowedAttachment('image/svg+xml')).toBe(false);
    expect(isAllowedAttachment('application/octet-stream')).toBe(false);
    expect(isAllowedAttachment('video/mp4')).toBe(false);
    expect(isAllowedAttachment('')).toBe(false);
  });

  it('distinguishes image thumbnail and file chip', () => {
    expect(isImageAttachment('image/png')).toBe(true);
    expect(isImageAttachment('application/pdf')).toBe(false);
    expect(isImageAttachment(undefined)).toBe(false);
  });

  it('caps at 8 attachments per comment (mirror of the backend Zod)', () => {
    expect(MAX_COMMENT_ATTACHMENTS).toBe(8);
  });
});
