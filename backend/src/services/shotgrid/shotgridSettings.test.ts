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
  it('fills an empty object with usable settings', () => {
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

    /**
     * A connection saved before ShotGrid thumbnails arrived does not have the key: it must read with the default, without migration or a setting to re-enter.
     */
  it('gives ShotGrid thumbnails to a connection predating the setting', () => {
    const s = parseSettings({ media: { source: 'original', autoImport: false } });
    expect(s.media.thumbnails).toBe(true);
    expect(s.media.autoImport).toBe(false);
  });

  it('opens reading and writing by default, except statuses and accounts', () => {
    const s = parseSettings({});
    expect(s.domains.tasks).toEqual({ read: true, write: true });
    expect(s.domains.versions).toEqual({ read: true, write: true });
        // Statuses are a reference received; accounts are never created from here.
    expect(s.domains.statuses.write).toBe(false);
    expect(s.domains.users.write).toBe(false);
  });

  it('keeps the explicit values', () => {
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
        // Domains not mentioned keep their default rather than disappearing.
    expect(s.domains.versions.read).toBe(true);
  });

  it('falls back to the defaults in front of a corrupt value rather than failing', () => {
        // A connection whose settings would be unreadable must remain usable: otherwise the synchronization would stop on an error that cannot be fixed through the UI.
    expect(parseSettings({ eventMode: 'carrier-pigeon' }).eventMode).toBe('webhook');
    expect(parseSettings(null).lockLocalCreation).toBe(true);
    expect(parseSettings('cassé').conflictPolicy).toBe('sg_wins');
  });

  it('bounds dangerous numeric values', () => {
    expect(parseSettings({ pollingIntervalSec: 1 }).pollingIntervalSec).toBe(60);
    expect(parseSettings({ pollingIntervalSec: 120 }).pollingIntervalSec).toBe(120);
  });
});

describe('can', () => {
  it('answers according to the project matrix', () => {
    const s = parseSettings({ domains: { notes: { read: true, write: false } } });
    expect(can(s, 'notes', 'read')).toBe(true);
    expect(can(s, 'notes', 'write')).toBe(false);
    expect(can(s, 'tasks', 'write')).toBe(true);
  });
});

describe('assertSafeBaseUrl', () => {
  it('accepts a hosted ShotGrid site', () => {
    expect(assertSafeBaseUrl('https://studio.shotgrid.autodesk.com')).toBe(
      'https://studio.shotgrid.autodesk.com',
    );
    expect(assertSafeBaseUrl('https://studio.shotgunstudio.com/')).toBe('https://studio.shotgunstudio.com');
  });

  it('normalizes by removing path and parameters', () => {
    expect(assertSafeBaseUrl('https://studio.shotgrid.autodesk.com/page/projects?x=1')).toBe(
      'https://studio.shotgrid.autodesk.com',
    );
  });

  it('refuses plaintext HTTP', () => {
    expect(() => assertSafeBaseUrl('http://studio.shotgrid.autodesk.com')).toThrow();
  });

  it('refuses anything that would target the internal network', () => {
        // Without this safeguard, an administrator could have the server query services that they themselves cannot reach (cloud metadata, administration).
    expect(() => assertSafeBaseUrl('https://localhost')).toThrow();
    expect(() => assertSafeBaseUrl('https://127.0.0.1')).toThrow();
    expect(() => assertSafeBaseUrl('https://10.0.0.5')).toThrow();
    expect(() => assertSafeBaseUrl('https://192.168.1.10')).toThrow();
    expect(() => assertSafeBaseUrl('https://172.16.4.2')).toThrow();
    expect(() => assertSafeBaseUrl('https://169.254.169.254')).toThrow();
    expect(() => assertSafeBaseUrl('https://[::1]')).toThrow();
    expect(() => assertSafeBaseUrl('https://minio.local')).toThrow();
  });

  it('refuses an unreadable URL', () => {
    expect(() => assertSafeBaseUrl('pas une url')).toThrow();
    expect(() => assertSafeBaseUrl('')).toThrow();
  });
});

describe('liens profonds', () => {
  it('points to the exact record of the entity', () => {
    expect(sgDeepLink('https://studio.shotgrid.autodesk.com', 'Shot', 2011)).toBe(
      'https://studio.shotgrid.autodesk.com/detail/Shot/2011',
    );
    expect(sgDeepLink('https://studio.shotgrid.autodesk.com/', 'Task', 5)).toBe(
      'https://studio.shotgrid.autodesk.com/detail/Task/5',
    );
  });

  it('opens a creation form pre-filled on the right project', () => {
    expect(sgCreateLink('https://studio.shotgrid.autodesk.com', 'Shot', 70)).toBe(
      'https://studio.shotgrid.autodesk.com/new/Shot?project=70',
    );
  });
});

describe('readOnlySettings', () => {
  it('closes all writes of a new connection', () => {
    const s = readOnlySettings();
    for (const domain of SG_DOMAINS) {
      expect(can(s, domain, 'write')).toBe(false);
    }
  });

  it('leaves reading open: that is the point of linking', () => {
    const s = readOnlySettings();
    expect(can(s, 'hierarchy', 'read')).toBe(true);
    expect(can(s, 'tasks', 'read')).toBe(true);
    expect(can(s, 'versions', 'read')).toBe(true);
  });

  it('sends nothing to ShotGrid on publication', () => {
        // A first synchronization must create nothing on a production site.
    expect(readOnlySettings().push.publishMode).toBe('off');
  });

  it('keeps the other settings of the schema', () => {
    const s = readOnlySettings();
    expect(s.lockLocalCreation).toBe(true);
    expect(s.conflictPolicy).toBe('sg_wins');
    expect(s.reconcile.enabled).toBe(true);
  });
});

/**
 * Statuses retained by the project: a display setting, but one that would be as easily lost as the status matches if the fallback discarded it.
 */
describe('visibleStatuses', () => {
  it('is "all" by default, scope by scope', () => {
    const s = parseSettings({});
    expect(s.visibleStatuses).toEqual({ task: [], shot: [], sequence: [], asset: [] });
  });

  it('keeps the ticked codes and completes the absent scopes', () => {
    const s = parseSettings({ visibleStatuses: { shot: ['ip', 'fin'] } });
    expect(s.visibleStatuses.shot).toEqual(['ip', 'fin']);
    expect(s.visibleStatuses.task).toEqual([]);
  });

  it('survives the read-only fallback when another section is unreadable', () => {
        // The fallback closes the writes; it must not erase a sort the studio has made.
    const s = parseSettings({ eventMode: 'carrier-pigeon', visibleStatuses: { task: ['wtg'] } });
    expect(s.visibleStatuses.task).toEqual(['wtg']);
  });
});
