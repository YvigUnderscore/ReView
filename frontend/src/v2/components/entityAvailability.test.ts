// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { ApiError } from '../../lib/apiClient';
import { isBadId, isMissingOrForbidden } from './entityAvailability';

/**
 * Les deux gardes qui empêchent une page d'entité de se rendre sur un sujet inexistant.
 * `/tasks/abc` affichait « Tâche #NaN » avec une zone de dépôt active, et `/shots/999999`
 * une page de plan complète avec « + Nouvelle version ».
 */
describe('isBadId', () => {
  it('refuse ce qui ne peut pas désigner une entité', () => {
    expect(isBadId(Number('abc'))).toBe(true); // /tasks/abc → NaN
    expect(isBadId(0)).toBe(true);
    expect(isBadId(-3)).toBe(true);
    expect(isBadId(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('accepte un identifiant plausible', () => {
    expect(isBadId(1)).toBe(false);
    expect(isBadId(8055)).toBe(false);
  });
});

describe('isMissingOrForbidden', () => {
  it('reconnaît l’absence et le refus', () => {
    expect(isMissingOrForbidden(new ApiError('nope', 404))).toBe(true);
    expect(isMissingOrForbidden(new ApiError('nope', 403))).toBe(true);
  });

  it('laisse passer une panne serveur, qui mérite « Réessayer » et non « n’existe plus »', () => {
    expect(isMissingOrForbidden(new ApiError('boom', 500))).toBe(false);
    expect(isMissingOrForbidden(new ApiError('slow', 504))).toBe(false);
    expect(isMissingOrForbidden(new Error('offline'))).toBe(false);
    expect(isMissingOrForbidden(undefined)).toBe(false);
  });
});
