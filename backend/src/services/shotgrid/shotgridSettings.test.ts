// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  assertSafeBaseUrl,
  can,
  parseSettings,
  readOnlySettings,
  sgCreateLink,
  sgDeepLink,
  SG_DOMAINS,
} from './shotgridSettings';

describe('parseSettings', () => {
  it('complète un objet vide avec des réglages utilisables', () => {
    const s = parseSettings({});
    expect(s.lockLocalCreation).toBe(true);
    expect(s.eventMode).toBe('webhook');
    expect(s.conflictPolicy).toBe('sg_wins');
    expect(s.media.source).toBe('transcoded');
    expect(s.media.autoImport).toBe(true);
    expect(s.push.publishMode).toBe('link');
    expect(s.reconcile.enabled).toBe(true);
    expect(s.reconcile.onBoot).toBe(true);
  });

  it('ouvre la lecture et l’écriture par défaut, sauf statuts et comptes', () => {
    const s = parseSettings({});
    expect(s.domains.tasks).toEqual({ read: true, write: true });
    expect(s.domains.versions).toEqual({ read: true, write: true });
    // Les statuts sont un référentiel reçu, les comptes ne se créent jamais d'ici.
    expect(s.domains.statuses.write).toBe(false);
    expect(s.domains.users.write).toBe(false);
  });

  it('conserve les valeurs explicites', () => {
    const s = parseSettings({
      lockLocalCreation: false,
      conflictPolicy: 'manual',
      domains: { tasks: { read: true, write: false } },
      media: { source: 'original', maxSizeMo: 500 },
    });
    expect(s.lockLocalCreation).toBe(false);
    expect(s.conflictPolicy).toBe('manual');
    expect(s.domains.tasks.write).toBe(false);
    expect(s.media.source).toBe('original');
    expect(s.media.maxSizeMo).toBe(500);
    // Les domaines non cités gardent leur défaut plutôt que de disparaître.
    expect(s.domains.versions.read).toBe(true);
  });

  it('retombe sur les défauts devant une valeur corrompue plutôt que d’échouer', () => {
    // Une connexion dont les réglages seraient illisibles doit rester exploitable :
    // la synchronisation s'arrêterait sinon sur une erreur impossible à corriger via l'UI.
    expect(parseSettings({ eventMode: 'carrier-pigeon' }).eventMode).toBe('webhook');
    expect(parseSettings(null).lockLocalCreation).toBe(true);
    expect(parseSettings('cassé').conflictPolicy).toBe('sg_wins');
  });

  it('borne les valeurs numériques dangereuses', () => {
    expect(parseSettings({ pollingIntervalSec: 1 }).pollingIntervalSec).toBe(60);
    expect(parseSettings({ pollingIntervalSec: 120 }).pollingIntervalSec).toBe(120);
  });
});

describe('can', () => {
  it('répond selon la matrice du projet', () => {
    const s = parseSettings({ domains: { notes: { read: true, write: false } } });
    expect(can(s, 'notes', 'read')).toBe(true);
    expect(can(s, 'notes', 'write')).toBe(false);
    expect(can(s, 'tasks', 'write')).toBe(true);
  });
});

describe('assertSafeBaseUrl', () => {
  it('accepte un site ShotGrid hébergé', () => {
    expect(assertSafeBaseUrl('https://studio.shotgrid.autodesk.com')).toBe(
      'https://studio.shotgrid.autodesk.com',
    );
    expect(assertSafeBaseUrl('https://studio.shotgunstudio.com/')).toBe('https://studio.shotgunstudio.com');
  });

  it('normalise en retirant chemin et paramètres', () => {
    expect(assertSafeBaseUrl('https://studio.shotgrid.autodesk.com/page/projects?x=1')).toBe(
      'https://studio.shotgrid.autodesk.com',
    );
  });

  it('refuse le HTTP en clair', () => {
    expect(() => assertSafeBaseUrl('http://studio.shotgrid.autodesk.com')).toThrow();
  });

  it('refuse ce qui viserait le réseau interne', () => {
    // Sans ce garde-fou, un administrateur pourrait faire interroger par le serveur
    // des services que lui-même n'atteint pas (métadonnées cloud, administration).
    expect(() => assertSafeBaseUrl('https://localhost')).toThrow();
    expect(() => assertSafeBaseUrl('https://127.0.0.1')).toThrow();
    expect(() => assertSafeBaseUrl('https://10.0.0.5')).toThrow();
    expect(() => assertSafeBaseUrl('https://192.168.1.10')).toThrow();
    expect(() => assertSafeBaseUrl('https://172.16.4.2')).toThrow();
    expect(() => assertSafeBaseUrl('https://169.254.169.254')).toThrow();
    expect(() => assertSafeBaseUrl('https://[::1]')).toThrow();
    expect(() => assertSafeBaseUrl('https://minio.local')).toThrow();
  });

  it('refuse une URL illisible', () => {
    expect(() => assertSafeBaseUrl('pas une url')).toThrow();
    expect(() => assertSafeBaseUrl('')).toThrow();
  });
});

describe('liens profonds', () => {
  it('pointe la fiche exacte de l’entité', () => {
    expect(sgDeepLink('https://studio.shotgrid.autodesk.com', 'Shot', 2011)).toBe(
      'https://studio.shotgrid.autodesk.com/detail/Shot/2011',
    );
    expect(sgDeepLink('https://studio.shotgrid.autodesk.com/', 'Task', 5)).toBe(
      'https://studio.shotgrid.autodesk.com/detail/Task/5',
    );
  });

  it('ouvre un formulaire de création pré-rempli sur le bon projet', () => {
    expect(sgCreateLink('https://studio.shotgrid.autodesk.com', 'Shot', 70)).toBe(
      'https://studio.shotgrid.autodesk.com/new/Shot?project=70',
    );
  });
});

describe('readOnlySettings', () => {
  it('ferme toutes les écritures d’une connexion neuve', () => {
    const s = readOnlySettings();
    for (const domain of SG_DOMAINS) {
      expect(can(s, domain, 'write')).toBe(false);
    }
  });

  it('laisse la lecture ouverte — c’est l’intérêt de relier', () => {
    const s = readOnlySettings();
    expect(can(s, 'hierarchy', 'read')).toBe(true);
    expect(can(s, 'tasks', 'read')).toBe(true);
    expect(can(s, 'versions', 'read')).toBe(true);
  });

  it('n’envoie rien vers ShotGrid à la publication', () => {
    // Une première synchronisation ne doit rien créer sur un site de production.
    expect(readOnlySettings().push.publishMode).toBe('off');
  });

  it('conserve les autres réglages du schéma', () => {
    const s = readOnlySettings();
    expect(s.lockLocalCreation).toBe(true);
    expect(s.conflictPolicy).toBe('sg_wins');
    expect(s.reconcile.enabled).toBe(true);
  });
});
