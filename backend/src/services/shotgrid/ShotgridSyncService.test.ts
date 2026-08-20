// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { mergeSyncOptions } from './ShotgridSyncService';

/**
 * Fusion des demandes de synchronisation arrivées pendant qu'une passe tournait.
 *
 * Ces demandes étaient purement jetées, et déclarées réussies : sur un site où chaque
 * webhook devient un job, la moitié des changements de statut simultanés ne remontait
 * jamais. La règle de fusion est donc conservatrice — on peut rattraper trop, jamais
 * trop peu.
 */
describe('mergeSyncOptions', () => {
  const targeted = (sgId: number) => ({
    kind: 'incremental' as const,
    onlySgIds: [{ sgType: 'Shot', sgId }],
  });

  it('additionne deux demandes ciblées', () => {
    const merged = mergeSyncOptions(targeted(1), targeted(2));
    expect(merged.onlySgIds).toEqual([
      { sgType: 'Shot', sgId: 1 },
      { sgType: 'Shot', sgId: 2 },
    ]);
  });

  it('ne duplique pas une entité demandée deux fois', () => {
    expect(mergeSyncOptions(targeted(1), targeted(1)).onlySgIds).toHaveLength(1);
  });

  it('élargit à tout le projet dès qu’une demande est globale', () => {
    // Une passe complète absorbe les demandes ciblées : elle les couvre toutes.
    expect(mergeSyncOptions(targeted(1), { kind: 'incremental' }).onlySgIds).toBeUndefined();
    expect(mergeSyncOptions({ kind: 'incremental' }, targeted(1)).onlySgIds).toBeUndefined();
  });

  it('garde le mode complet s’il est demandé par l’une des deux', () => {
    expect(mergeSyncOptions({ kind: 'incremental' }, { kind: 'full' }).kind).toBe('full');
    expect(mergeSyncOptions({ kind: 'full' }, { kind: 'incremental' }).kind).toBe('full');
  });

  it('retient la fenêtre la plus large', () => {
    const vieux = new Date('2026-08-01T00:00:00Z');
    const recent = new Date('2026-08-19T00:00:00Z');
    expect(mergeSyncOptions({ since: recent }, { since: vieux }).since).toEqual(vieux);
    // Une demande sans fenêtre porte sur tout : elle ne doit pas être bornée.
    expect(mergeSyncOptions({ since: recent }, {}).since).toBeNull();
  });

  it('conserve le média dès qu’une des deux le demande', () => {
    expect(mergeSyncOptions({ withMedia: false }, { withMedia: true }).withMedia).toBe(true);
  });
});
