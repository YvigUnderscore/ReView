// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { ReviewRequestRule } from '../types/api';
import { noteIssue, toNotePayload } from './reviewRequestRule';

/**
 * La règle de consigne est écrite trois fois — service, API, écran. Ces tests tiennent la
 * troisième au même contrat que les deux autres : un bouton actif sur une requête que le
 * serveur refuserait est le seul défaut que cette duplication peut produire.
 */

const rule = (requireNote: boolean, minNoteLength = 5): ReviewRequestRule => ({
  requireNote,
  minNoteLength,
});

describe('noteIssue', () => {
  it('tolère l’absence de consigne quand le projet ne l’exige pas', () => {
    expect(noteIssue('', rule(false))).toBeNull();
    expect(noteIssue('   ', rule(false))).toBeNull();
  });

  it('refuse l’absence de consigne quand le projet l’exige', () => {
    expect(noteIssue('', rule(true))).toBe('missing');
    // L'espace ne fait pas une consigne : sans `trim`, cinq espaces passeraient le plancher.
    expect(noteIssue('     ', rule(true))).toBe('missing');
  });

  it('applique le plancher même à une consigne facultative', () => {
    expect(noteIssue('ok', rule(false, 5))).toBe('too-short');
    expect(noteIssue('la lumière', rule(false, 5))).toBeNull();
  });

  it('mesure la consigne après nettoyage des espaces de bordure', () => {
    expect(noteIssue('  abc  ', rule(true, 5))).toBe('too-short');
    expect(noteIssue('  abcde  ', rule(true, 5))).toBeNull();
  });
});

describe('toNotePayload', () => {
  it('rend `null` plutôt qu’une chaîne vide — le modèle ne connaît que l’absence', () => {
    expect(toNotePayload('   ')).toBeNull();
    expect(toNotePayload('')).toBeNull();
  });

  it('nettoie les bords de ce qu’on garde', () => {
    expect(toNotePayload('  la lumière  ')).toBe('la lumière');
  });
});
