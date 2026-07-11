import { describe, it, expect } from 'vitest';
import { isAllowedAttachment, isImageAttachment } from './commentAttachments';

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
});
