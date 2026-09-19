// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { assertUploadNote } from './uploadNote';
import { REVIEW_NOTE_MAX_LENGTH, type ReviewRequestRule } from './projectSettings';
import { AppError } from './errors';

const rule = (requireNote: boolean, minNoteLength = 5): ReviewRequestRule => ({ requireNote, minNoteLength });

/** Le code du refus, ou `null` quand la consigne passe. */
function codeOf(note: string | null | undefined, r: ReviewRequestRule): string | undefined | null {
  try {
    assertUploadNote(note, r);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).statusCode).toBe(400);
    return (e as AppError).code;
  }
}

describe('assertUploadNote — consigne obligatoire déplacée à l’upload (Phase 50)', () => {
  it('laisse passer l’absence de consigne quand le projet n’en exige pas', () => {
    for (const note of [undefined, null, '', '   ']) {
      expect(codeOf(note, rule(false))).toBeNull();
      expect(assertUploadNote(note, rule(false))).toBeNull();
    }
  });

  it('refuse l’absence de consigne quand le projet l’exige', () => {
    for (const note of [undefined, null, '', '   ']) {
      expect(codeOf(note, rule(true))).toBe('UPLOAD_NOTE_REQUIRED');
    }
  });

  it('applique le plancher à TOUTE consigne écrite, même facultative', () => {
    // Une consigne de deux caractères n'est pas une consigne courte : c'est un champ vide
    // qui a pris la place d'un champ vide. Même arbitrage que pour les consignes de review.
    expect(codeOf('ok', rule(false, 5))).toBe('UPLOAD_NOTE_TOO_SHORT');
    expect(codeOf('ok', rule(true, 5))).toBe('UPLOAD_NOTE_TOO_SHORT');
  });

  it('compare après `trim` : cinq espaces ne satisfont pas un plancher de cinq', () => {
    expect(codeOf('     ', rule(true, 5))).toBe('UPLOAD_NOTE_REQUIRED');
  });

  it('rend la consigne nettoyée de ses espaces de bord', () => {
    expect(assertUploadNote('  Regarder le raccord au 1042  ', rule(true))).toBe(
      'Regarder le raccord au 1042',
    );
  });

  it('borne la longueur stockée — le champ ne dicte pas la taille de la colonne', () => {
    const long = 'a'.repeat(REVIEW_NOTE_MAX_LENGTH + 500);
    expect(assertUploadNote(long, rule(true))).toHaveLength(REVIEW_NOTE_MAX_LENGTH);
  });
});
