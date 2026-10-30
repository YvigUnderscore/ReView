// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { BASE_LOCALE, LOCALE_CODES, loadCatalog, setLocale, t } from '../i18n';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY, TASK_STATUS_COLOR, TASK_STATUS_BAR } from './taskStatus';

const catalogs = import.meta.glob<{ default: Record<string, unknown> }>('../i18n/messages/*.json', {
  eager: true,
});

/**
 * `t()` returns the key itself when it is missing everywhere — a status then reads
 * "task.status.todo" instead of "To do", in the menu as in the gauges. The `MessageKey` typing forbids
 * writing a non-existent key, but says nothing about tables that, like this one, map a business value to
 * a key: that is the link the test locks.
 *
 * The round of fourteen languages does not measure coverage — a missing translation falls back to
 * English, and the project admits it. It checks that no language lets the bare key through to the screen,
 * including through a badly resolved fallback.
 */
describe('task status labels', () => {
  it('covers each status with a key and colours', () => {
    for (const status of TASK_STATUSES) {
      expect(TASK_STATUS_LABEL_KEY[status]).toBeDefined();
      expect(TASK_STATUS_COLOR[status]).toBeDefined();
      expect(TASK_STATUS_BAR[status]).toBeDefined();
    }
  });

  it('defines the six statuses in the base catalogue', () => {
    const base = catalogs[`../i18n/messages/${BASE_LOCALE}.json`].default;
    for (const status of TASK_STATUSES) {
      const key = TASK_STATUS_LABEL_KEY[status];
      expect(base[key], `${key} manque à ${BASE_LOCALE}.json`).toBeDefined();
    }
  });

  it.each(LOCALE_CODES)('n’affiche aucune clé nue en %s', async (code) => {
    await loadCatalog(code);
    await setLocale(code, { persist: false });
    for (const status of TASK_STATUSES) {
      const key = TASK_STATUS_LABEL_KEY[status];
      const label = t(key);
      expect(label, `${code} : ${key} ressort telle quelle`).not.toBe(key);
      expect(label.trim()).not.toBe('');
    }
  });
});
