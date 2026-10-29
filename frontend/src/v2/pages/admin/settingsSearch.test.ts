// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { t } from '../../i18n';
import {
  SECTION_KEYWORDS,
  SECTION_SETTING_LABELS,
  fold,
  sectionHaystack,
  sectionMatches,
} from './settingsSearch';
import { adminSections } from './adminSections';

/**
 * Twenty-eight sections in five groups, with no way to search: to find the
 * watermark you had to know it lives in "Distribution", and for log retention that it is not
 * in the same place as trash retention.
 */
const haystackOf = (key: string, label = '') => sectionHaystack(key, label, t);

describe('search in the settings', () => {
  it('finds a section by a word people actually use, not by its title', () => {
    // Nobody searches for "Distribution": they search for "watermark".
    expect(sectionMatches(haystackOf('distribution'), 'watermark')).toBe(true);
    expect(sectionMatches(haystackOf('distribution'), 'filigrane')).toBe(true);
    expect(sectionMatches(haystackOf('distribution'), 'burn-in')).toBe(true);
  });

  it('ignores case and accents', () => {
    expect(sectionMatches(haystackOf('retention'), 'RÉTENTION')).toBe(true);
    expect(sectionMatches(haystackOf('retention'), 'retention')).toBe(true);
  });

  it('requires all the words: "quota slack" does not return half the administration', () => {
    expect(sectionMatches(haystackOf('storage'), 'quota slack')).toBe(false);
    expect(sectionMatches(haystackOf('storage'), 'stockage bucket')).toBe(true);
  });

  /**
   * Each setting is indexed in the section that renders it. While all fourteen lived in the
   * same place, searching for "quota" or "trash" always led to the same screen —
   * the one that stacked them all.
   */
  it('indexes each setting in the section that renders it, and nowhere else', () => {
    expect(haystackOf('storage')).toContain(fold(t('settings.maxUploads')));
    expect(haystackOf('storage')).toContain(fold(t('settings.storageQuota')));
    expect(haystackOf('retention')).toContain(fold(t('settings.trashRetention')));
    expect(haystackOf('chat')).toContain(fold(t('settings.slackWebhook')));
    expect(haystackOf('defaults')).toContain(fold(t('settings.defaultStartFrame')));
    // The "Settings" section no longer carries them: it keeps only the studio's identity.
    expect(haystackOf('settings')).not.toContain(fold(t('settings.maxUploads')));
    expect(haystackOf('settings')).not.toContain(fold(t('settings.trashRetention')));
  });

  it('lets everything through when the search is empty', () => {
    expect(sectionMatches(haystackOf('jobs'), '')).toBe(true);
    expect(sectionMatches(haystackOf('jobs'), '   ')).toBe(true);
  });

  it('finds nothing for an absent word — the "no settings" message must be able to show', () => {
    expect(sectionMatches(haystackOf('jobs'), 'zzzz')).toBe(false);
  });

  /**
   * The registry only declared the twelve key/value settings, out of some sixty
   * actually rendered: "CRF", "slate", "STARTTLS", "batch size" or "scopes"
   * led nowhere — that is to say, exactly the settings one never remembers
   * the location of. Each is now indexed in the section that renders it.
   */
  it('indexes the settings the sections really render, not only the key/value ones', () => {
    const cas: [string, string][] = [
      ['video', t('transcode.crf')],
      ['video', t('transcode.audioKbps')],
      ['distribution', t('burnin.slateShort')],
      ['smtp', t('smtp.allowInsecure')],
      ['retention', t('retention.batchSize')],
      ['api', t('webhooks.hmacSecret')],
      ['identity', t('sso.clientSecret')],
      ['shotgrid', t('shotgrid.site.scriptKey')],
      ['service-tokens', t('tokens.allProjects')],
      ['jobs', t('jobs.purgeDerived')],
      ['login-appearance', t('login.appearance.tagline')],
      ['defaults', t('settings.draftMode')],
    ];
    for (const [key, label] of cas) {
      expect(sectionMatches(haystackOf(key), label), `${key} / ${label}`).toBe(true);
    }
  });

  it('declares only sections that exist — a rename leaves no orphan index', () => {
    // `Set<string>` and not `Set<SectionKey>`: we query precisely with RAW keys,
    // those of the two indexes, to catch a rename that typing would not see.
    const connues = new Set<string>(adminSections(t).map((s) => s.key));
    for (const key of Object.keys(SECTION_SETTING_LABELS)) expect(connues.has(key), key).toBe(true);
    for (const key of Object.keys(SECTION_KEYWORDS)) expect(connues.has(key), key).toBe(true);
  });

  it('covers each section with at least one keyword', () => {
    expect(Object.keys(SECTION_KEYWORDS).length).toBeGreaterThanOrEqual(28);
    for (const [key, words] of Object.entries(SECTION_KEYWORDS)) {
      expect(words.length, key).toBeGreaterThan(0);
    }
  });
});

describe('fold', () => {
  it('replie accents et casse', () => {
    expect(fold('Éléments Masqués')).toBe('elements masques');
  });
});
