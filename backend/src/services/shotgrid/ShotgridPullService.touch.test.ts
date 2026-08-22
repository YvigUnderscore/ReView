// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est remonté en tête de fichier : les doublures doivent l'être aussi.
const { emitToProject } = vi.hoisted(() => ({ emitToProject: vi.fn() }));

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({
  mapSgToLocal: vi.fn(),
  removeLink: vi.fn(),
  findByLocal: vi.fn(),
  findBySg: vi.fn(),
  upsertLink: vi.fn(),
}));
vi.mock('../SocketService', () => ({ emitToProject: (...a: unknown[]) => emitToProject(...a) }));

import { touch, type PullContext } from './ShotgridPullService';
import { TouchedEntities } from './ShotgridTouched';

function context(touched?: TouchedEntities): PullContext {
  return { connection: { id: 1, projectId: 7 }, touched } as unknown as PullContext;
}

beforeEach(() => vi.clearAllMocks());

/**
 * Le collecteur est optionnel : une passe orchestrée l'apporte et vide l'accumulateur en
 * fin de course, un appelant isolé (import manuel de versions) n'a personne pour le
 * faire — il doit donc continuer d'émettre tout de suite.
 */
describe('touch', () => {
  it('accumule au lieu d’émettre quand la passe est orchestrée', () => {
    const touched = new TouchedEntities();
    touch(context(touched), 'shot', 12);

    expect(emitToProject).not.toHaveBeenCalled();
    expect(touched.detail()).toEqual([{ kind: 'shot', id: 12 }]);
  });

  it('émet tout de suite sans collecteur', () => {
    touch(context(), 'task', 5, { shotId: 12, assetId: null });

    expect(emitToProject).toHaveBeenCalledWith(7, 'task:update', {
      projectId: 7,
      id: 5,
      shotId: 12,
      assetId: null,
    });
  });

  it('n’invente pas d’événement pour les familles que le client n’écoute pas', () => {
    touch(context(), 'comment', 555);
    touch(context(), 'playlist', 60);
    expect(emitToProject).not.toHaveBeenCalled();
  });
});
