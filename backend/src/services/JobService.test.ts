// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeAll, describe, expect, it, vi } from 'vitest';

// Aucune connexion Redis dans un test unitaire : seule la déclaration des files nous
// intéresse (leur nom, leur étiquette de métrique et leur exhaustivité).
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(public readonly name: string) {}
  },
}));

// Import différé (et non `await` de premier niveau, interdit par la cible TS du projet) :
// le mock de bullmq doit être en place avant que le module ne déclare ses files.
let mod: typeof import('./JobService');
beforeAll(async () => {
  mod = await import('./JobService');
});

describe('déclaration des files', () => {
  it('les six files sont étiquetées, aucune n’échappe aux métriques', () => {
    expect(Object.keys(mod.QUEUE_LABELS).sort()).toEqual([
      'maintenance',
      'media',
      'shotgrid',
      'storage-cleanup',
      'timeline-export',
      'webhooks',
    ]);
    expect(mod.ALL_QUEUES).toHaveLength(6);
  });

  it('toute file déclarée dans QUEUE_NAMES est étiquetée', () => {
    const declared = Object.values(mod.QUEUE_NAMES);
    const labelled = mod.ALL_QUEUES.map(([, q]) => (q as unknown as { name: string }).name);
    for (const name of declared) expect(labelled).toContain(name);
  });

  it('l’étiquette historique « media » est préservée (tableau Grafana et doc d’exploitation)', () => {
    // Le nom de file est `media-processing`, mais Prometheus expose queue="media" depuis
    // toujours : renommer casserait les requêtes et alertes existantes.
    expect(mod.QUEUE_NAMES.MEDIA).toBe('media-processing');
    const media = mod.ALL_QUEUES.find(([label]) => label === 'media');
    expect((media?.[1] as unknown as { name: string }).name).toBe('media-processing');
  });

  it('l’identifiant d’export de montage reste déterministe (double clic sans effet)', () => {
    expect(mod.timelineExportJobId(42)).toBe('timeline-42');
  });
});
