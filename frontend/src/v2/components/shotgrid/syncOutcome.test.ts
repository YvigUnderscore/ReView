// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { syncOutcome } from './syncOutcome';

describe('syncOutcome', () => {
  it("n'annonce pas une passe terminée quand elle est seulement en file", () => {
    // Le défaut d'origine : « Synchronisation terminée » en vert pour une demande qui
    // attendait derrière une passe en cours. Ni le ton ni le message ne doivent le dire.
    const outcome = syncOutcome('deferred');
    expect(outcome.tone).toBe('info');
    expect(outcome.key).toBe('shotgrid.sync.queued');
  });

  it('parle de la synchronisation entière, pas de la relecture d’une entité', () => {
    // La pastille a sa propre phrase (« cette relecture ») : la reprendre ici ferait
    // parler le bouton d'un geste que l'utilisateur n'a pas fait.
    expect(syncOutcome('deferred').key).not.toBe('shotgrid.sync.dot.queued');
  });

  it('garde le rouge pour un échec et le vert pour une passe faite', () => {
    expect(syncOutcome('error')).toEqual({ tone: 'error', key: 'shotgrid.sync.failed' });
    expect(syncOutcome('ok')).toEqual({ tone: 'success', key: 'shotgrid.sync.done' });
  });

  it('retombe sur « terminé » pour un statut absent ou inconnu', () => {
    // La passe a eu lieu : seul son détail nous échappe. L'inverse — un rouge par défaut —
    // ferait relancer une synchronisation qui s'est bien déroulée.
    expect(syncOutcome(undefined).tone).toBe('success');
    expect(syncOutcome('partial').tone).toBe('success');
  });
});
