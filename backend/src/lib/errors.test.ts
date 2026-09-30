// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from './errors';

/**
 * Le code d'erreur est ce que le client traduit : c'est lui, et non le message anglais,
 * qui décide de la langue lue par l'utilisateur. Ces tests fixent le contrat des replis.
 */
describe('erreurs typées', () => {
  it('porte statut, message et code', () => {
    const err = badRequest('Empty path', 'PATH_EMPTY');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Empty path');
    expect(err.code).toBe('PATH_EMPTY');
  });

  it('sans argument : message anglais et code générique', () => {
    expect(unauthorized()).toMatchObject({
      statusCode: 401,
      message: 'Not authenticated',
      code: 'UNAUTHENTICATED',
    });
    expect(notFound()).toMatchObject({ statusCode: 404, message: 'Resource not found', code: 'NOT_FOUND' });
    expect(forbidden()).toMatchObject({ statusCode: 403, message: 'Access denied', code: 'FORBIDDEN' });
  });

  it('message précis sans code : aucun code générique posé', () => {
    // Sinon le client afficherait « Resource not found » à la place de la précision
    // rédigée par l'appelant — la traduction est un progrès, pas une perte d'information.
    expect(notFound('Media not found').code).toBeUndefined();
  });

  it('message et code précis : les deux sont conservés', () => {
    expect(notFound('Shot not found', 'SHOT_NOT_FOUND')).toMatchObject({
      message: 'Shot not found',
      code: 'SHOT_NOT_FOUND',
    });
  });

  it('conflit et requête invalide exigent leur message', () => {
    expect(conflict('Code already taken', 'CODE_TAKEN')).toMatchObject({
      statusCode: 409,
      code: 'CODE_TAKEN',
    });
    expect(badRequest('Bad key').code).toBeUndefined();
  });
});
