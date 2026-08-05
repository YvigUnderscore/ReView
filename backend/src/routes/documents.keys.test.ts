// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isValidDocumentKey } from './documents.routes';

describe('isValidDocumentKey', () => {
  it('accepte les clés produites par /pdf/presign', () => {
    expect(isValidDocumentKey('documents/1700000000000-brief.pdf')).toBe(true);
  });

  // La clé arrive du client puis sert à signer une URL de lecture et à effacer l'objet :
  // pointer ailleurs dans le bucket exfiltrerait (ou détruirait) le média d'un autre projet.
  it('refuse toute clé hors du dossier des documents', () => {
    for (const k of [
      'media/42/source.exr',
      'comments/attachments/9/1700-secret.png',
      'studio/logo.png',
      '',
      'Documents/brief.pdf', // casse différente = autre préfixe
    ])
      expect(isValidDocumentKey(k)).toBe(false);
  });

  it('refuse les tentatives de remontée de chemin', () => {
    expect(isValidDocumentKey('documents/../media/42/source.exr')).toBe(false);
    expect(isValidDocumentKey('documents/a/../../x')).toBe(false);
  });

  it('refuse l’absence de clé', () => {
    expect(isValidDocumentKey(null)).toBe(false);
    expect(isValidDocumentKey(undefined)).toBe(false);
  });
});
