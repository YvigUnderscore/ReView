// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  BACKUP_STAMP,
  CANCELLABLE_PHASES,
  RUN_ID,
  VERSION_TAG,
  buildOrder,
  clampSeconds,
  newRunId,
  statusSchema,
} from './opsOrder';

describe('les filtres du protocole', () => {
  it('accepte une étiquette de version, et rien qui lui ressemble', () => {
    for (const good of ['v2.4.0', 'v2.10.3', 'v3.0.0-rc.1', 'v2.4.0-beta.2']) {
      expect(VERSION_TAG.test(good), good).toBe(true);
    }
    // Chacune de ces valeurs finirait en argument de `git checkout` ou de `docker compose`.
    for (const bad of [
      'v2.4.0; rm -rf /',
      'v2.4.0 && curl evil',
      '../../etc/passwd',
      '-v2.4.0',
      'latest',
      'v2.4',
      'v2.4.0\nv1.0.0',
      '$(id)',
      '`id`',
      'v2.4.0 ',
    ]) {
      expect(VERSION_TAG.test(bad), bad).toBe(false);
    }
  });

  it('accepte un identifiant de sauvegarde, qui est un nom de dossier', () => {
    expect(BACKUP_STAMP.test('20260910-030000')).toBe(true);
    for (const bad of ['20260910', '../backups', '20260910-030000/..', '2026091-030000']) {
      expect(BACKUP_STAMP.test(bad), bad).toBe(false);
    }
  });

  it('accepte un identifiant d’exécution, qui est aussi un nom de dossier', () => {
    expect(RUN_ID.test('20260910-142233-a1b2c3')).toBe(true);
    for (const bad of ['20260910-142233', '20260910-142233-A1B2C3', '20260910-142233-a1b2c3/..', '..']) {
      expect(RUN_ID.test(bad), bad).toBe(false);
    }
  });
});

describe('newRunId', () => {
  it('horodate — donc trie — et rend deux ordres du même instant distincts', () => {
    const at = new Date(2026, 8, 10, 14, 22, 33);
    expect(newRunId(at, () => 'a1b2c3')).toBe('20260910-142233-a1b2c3');
    expect(RUN_ID.test(newRunId(at))).toBe(true);
    expect(newRunId(at)).not.toBe(newRunId(at));
  });

  it('range les identifiants dans l’ordre du temps', () => {
    const early = newRunId(new Date(2026, 8, 10, 9, 5, 0), () => 'ffffff');
    const late = newRunId(new Date(2026, 8, 10, 14, 22, 33), () => '000000');
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe('clampSeconds', () => {
  it('borne, tronque, et refuse ce qui n’est pas un nombre', () => {
    expect(clampSeconds(600, 60, 3600)).toBe(600);
    expect(clampSeconds(5, 60, 3600)).toBe(60);
    expect(clampSeconds(99_999, 60, 3600)).toBe(3600);
    expect(clampSeconds(60.9, 60, 3600)).toBe(60);
    expect(clampSeconds(Number.NaN, 60, 3600)).toBe(60);
    expect(clampSeconds(Number.POSITIVE_INFINITY, 60, 3600)).toBe(60);
  });
});

describe('buildOrder', () => {
  const now = new Date('2026-09-10T14:22:33.000Z');
  const actor = { id: 3, displayName: 'ops@studio.tld' };

  it('rend un ordre complet, borné et daté', () => {
    const order = buildOrder({
      id: '20260910-142233-a1b2c3',
      kind: 'update',
      now,
      ttlSec: 900,
      actor,
      version: 'v2.4.0',
    });
    expect(order).toMatchObject({
      protocol: 1,
      kind: 'update',
      createdAt: '2026-09-10T14:22:33.000Z',
      expiresAt: '2026-09-10T14:37:33.000Z',
      actor,
    });
    expect(order.params).toEqual({
      version: 'v2.4.0',
      backupId: null,
      skipBackup: false,
      readyTimeoutSec: 600,
      maxRuntimeSec: 3600,
    });
  });

  it('borne les durées quoi qu’on lui passe', () => {
    // `readyTimeoutSec` atterrit dans « $(( SECONDS + READY_TIMEOUT )) », où bash ré-évalue
    // le contenu de la variable. C'est la première des trois passes de filtrage.
    const order = buildOrder({
      id: '20260910-142233-a1b2c3',
      kind: 'backup',
      now,
      ttlSec: 10,
      actor,
      readyTimeoutSec: 10_000_000,
      maxRuntimeSec: -5,
    });
    expect(order.params.readyTimeoutSec).toBe(3600);
    expect(order.params.maxRuntimeSec).toBe(60);
    // TTL borné aussi : un ordre valable dix secondes n'atteindrait jamais l'agent.
    expect(order.expiresAt).toBe('2026-09-10T14:23:33.000Z');
  });
});

describe('CANCELLABLE_PHASES', () => {
  it('ne laisse annuler que tant que rien n’est basculé', () => {
    // Tuer le script après la bascule laisserait la pile à moitié recréée, et le retour
    // arrière automatique — la seule promesse de sécurité de la commande — n'aurait pas eu lieu.
    for (const phase of ['queued', 'precheck', 'backup'])
      expect(CANCELLABLE_PHASES.has(phase), phase).toBe(true);
    for (const phase of ['switch', 'health', 'rollback', 'done']) {
      expect(CANCELLABLE_PHASES.has(phase), phase).toBe(false);
    }
  });
});

describe('statusSchema', () => {
  it('lit un statut minimal — un agent plus ancien n’a pas tous les champs', () => {
    const parsed = statusSchema.safeParse({ id: 'x', kind: 'update', state: 'running' });
    expect(parsed.success).toBe(true);
  });

  it('ignore ce qu’il ne connaît pas — le protocole n’évolue qu’additivement', () => {
    const parsed = statusSchema.safeParse({ id: 'x', kind: 'update', state: 'running', futurChamp: 42 });
    expect(parsed.success).toBe(true);
  });

  it('refuse un statut sans identité', () => {
    expect(statusSchema.safeParse({ kind: 'update', state: 'running' }).success).toBe(false);
  });
});
