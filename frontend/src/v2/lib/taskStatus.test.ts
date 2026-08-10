// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { BASE_LOCALE, LOCALE_CODES, loadCatalog, setLocale, t } from '../i18n';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY, TASK_STATUS_COLOR, TASK_STATUS_BAR } from './taskStatus';

const catalogs = import.meta.glob<{ default: Record<string, unknown> }>('../i18n/messages/*.json', {
  eager: true,
});

/**
 * `t()` rend la clé elle-même quand elle manque partout — un statut se lit alors
 * « task.status.todo » au lieu de « À faire », dans le menu comme dans les jauges. Le
 * typage `MessageKey` interdit d'écrire une clé inexistante, mais il ne dit rien des
 * tables qui, comme celle-ci, associent une valeur métier à une clé : c'est ce chaînon
 * que le test verrouille.
 *
 * Le tour des quatorze langues ne mesure pas la couverture — une traduction absente
 * retombe sur l'anglais, et le projet l'admet. Il vérifie qu'aucune langue ne laisse
 * passer la clé nue jusqu'à l'écran, y compris par un repli mal résolu.
 */
describe('libellés des statuts de tâche', () => {
  it('couvre chaque statut par une clé et des couleurs', () => {
    for (const status of TASK_STATUSES) {
      expect(TASK_STATUS_LABEL_KEY[status]).toBeDefined();
      expect(TASK_STATUS_COLOR[status]).toBeDefined();
      expect(TASK_STATUS_BAR[status]).toBeDefined();
    }
  });

  it('définit les six statuts dans le catalogue de base', () => {
    const base = catalogs[`../i18n/messages/${BASE_LOCALE}.json`]!.default;
    for (const status of TASK_STATUSES) {
      const key = TASK_STATUS_LABEL_KEY[status]!;
      expect(base[key], `${key} manque à ${BASE_LOCALE}.json`).toBeDefined();
    }
  });

  it.each(LOCALE_CODES)('n’affiche aucune clé nue en %s', async (code) => {
    await loadCatalog(code);
    await setLocale(code, { persist: false });
    for (const status of TASK_STATUSES) {
      const key = TASK_STATUS_LABEL_KEY[status]!;
      const label = t(key);
      expect(label, `${code} : ${key} ressort telle quelle`).not.toBe(key);
      expect(label.trim()).not.toBe('');
    }
  });
});
