// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  ALL_PASSES,
  eventIsGlobal,
  HANDLED_ENTITIES,
  impliedPasses,
  mergePasses,
  passesForEvent,
  resolvePasses,
  sgIdsOfType,
} from './ShotgridSyncPasses';

/**
 * Le défaut réparé ici est silencieux : un événement Note ou Playlist était accepté, mis
 * en file et traité — sans jamais rien importer, faute d'une passe capable de le lire.
 * Ces vérifications tiennent le lien entre « type d'événement accepté » et « passe
 * réellement exécutée ».
 */
describe('passesForEvent', () => {
  it('déclenche une passe de notes pour un événement Note', () => {
    expect(passesForEvent('Note')).toEqual(['notes']);
  });

  it('déclenche une passe de playlists pour un événement Playlist', () => {
    expect(passesForEvent('Playlist')).toEqual(['playlists']);
  });

  it('ne relit que les versions pour un événement Version', () => {
    // Le référentiel de statuts ne sert pas ici : la version lit sa correspondance
    // persistée, et une passe complète de la hiérarchie coûterait des milliers de requêtes.
    expect(passesForEvent('Version')).toEqual(['versions']);
  });

  it('accompagne du référentiel toute passe qui lit un statut', () => {
    for (const entity of ['Sequence', 'Shot', 'Task']) {
      expect(passesForEvent(entity)).toContain('statuses');
    }
    // L'asset ne porte pas de statut côté ReView : il s'en passe.
    expect(passesForEvent('Asset')).toEqual(['assets']);
  });

  it('relit toute la hiérarchie pour une entité globale, sans les médias', () => {
    expect(passesForEvent('Status')).toEqual(['statuses', 'sequences', 'shots', 'assets', 'tasks']);
    expect(passesForEvent('Status')).not.toContain('versions');
    expect(eventIsGlobal('Status')).toBe(true);
    expect(eventIsGlobal('HumanUser')).toBe(true);
    expect(eventIsGlobal('Shot')).toBe(false);
  });

  it('ignore un type qu’aucune passe ne sait traiter', () => {
    expect(passesForEvent('Ticket')).toBeNull();
    expect(HANDLED_ENTITIES.has('Ticket')).toBe(false);
  });

  it('n’accepte que les types réellement traités', () => {
    // La liste des entités acceptées se déduit de la table des passes : elles ne peuvent
    // plus diverger, ce qui était exactement le défaut des notes et des playlists.
    for (const entity of HANDLED_ENTITIES) expect(passesForEvent(entity)).not.toBeNull();
  });
});

describe('impliedPasses', () => {
  it('déduit les passes du type ciblé', () => {
    expect(impliedPasses([{ sgType: 'Shot', sgId: 3 }])).toEqual(['statuses', 'shots']);
  });

  it('unit les passes de plusieurs types ciblés, dans l’ordre canonique', () => {
    expect(
      impliedPasses([
        { sgType: 'Version', sgId: 1 },
        { sgType: 'Sequence', sgId: 2 },
      ]),
    ).toEqual(['statuses', 'sequences', 'versions']);
  });

  it('rend « tout » quand rien n’est ciblé ou que le type est inconnu', () => {
    expect(impliedPasses(undefined)).toBeUndefined();
    expect(impliedPasses([])).toBeUndefined();
    expect(impliedPasses([{ sgType: 'Ticket', sgId: 9 }])).toBeUndefined();
  });
});

describe('resolvePasses', () => {
  it('exécute tout quand rien n’est précisé', () => {
    expect([...resolvePasses({})]).toEqual([...ALL_PASSES]);
  });

  it('préfère la liste explicite à la déduction', () => {
    const passes = resolvePasses({ passes: ['notes'], onlySgIds: [{ sgType: 'Shot', sgId: 1 }] });
    expect([...passes]).toEqual(['notes']);
  });

  it('épargne notes, playlists et publishes au réalignement d’une seule carte', () => {
    // C'est le cœur du correctif : réaligner un plan balayait les cinq mille
    // `PublishedFile` du projet et ses cinq cents notes.
    const passes = resolvePasses({ onlySgIds: [{ sgType: 'Shot', sgId: 12 }] });
    expect(passes.has('notes')).toBe(false);
    expect(passes.has('playlists')).toBe(false);
    expect(passes.has('publishedFiles')).toBe(false);
    expect(passes.has('shots')).toBe(true);
  });

  it('garde « structure seule » comme veto sur la liste déduite', () => {
    // Arbitrer un conflit de version demande `withMedia: false` : la déduction ne doit
    // pas rouvrir la porte au rapatriement des médias.
    const passes = resolvePasses({ onlySgIds: [{ sgType: 'Version', sgId: 7 }], withMedia: false });
    expect(passes.has('versions')).toBe(false);
  });

  it('respecte « structure seule » sans ciblage', () => {
    const passes = resolvePasses({ withMedia: false });
    expect(passes.has('versions')).toBe(false);
    expect(passes.has('notes')).toBe(false);
    expect(passes.has('shots')).toBe(true);
  });
});

describe('mergePasses', () => {
  it('unit deux listes', () => {
    expect(mergePasses(['notes'], ['versions'])).toEqual(['versions', 'notes']);
  });

  it('laisse « tout » absorber une liste', () => {
    expect(mergePasses(['notes'], undefined)).toBeUndefined();
    expect(mergePasses(undefined, ['notes'])).toBeUndefined();
  });
});

describe('sgIdsOfType', () => {
  it('extrait les identifiants d’un type, sans doublon', () => {
    const ids = sgIdsOfType(
      [
        { sgType: 'Note', sgId: 4 },
        { sgType: 'Version', sgId: 9 },
        { sgType: 'Note', sgId: 4 },
        { sgType: 'Note', sgId: 5 },
      ],
      'Note',
    );
    expect(ids).toEqual([4, 5]);
  });

  it('rend une liste vide quand rien n’est ciblé', () => {
    expect(sgIdsOfType(undefined, 'Note')).toEqual([]);
    expect(sgIdsOfType([{ sgType: 'Shot', sgId: 1 }], 'Note')).toEqual([]);
  });
});
