// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import type { NamingRule, NamingMode } from '../types/api';
import { useT } from '../i18n';

import type { MessageKey } from '../i18n';

const MODE_KEY: Record<NamingMode, MessageKey> = {
  off: 'naming.policy.off',
  warn: 'naming.policy.warn',
  reject: 'naming.policy.reject',
};

/**
 * Convention de nommage des fichiers à l'upload (38.C) : motif regex + politique
 * (off/warn/reject) + test en direct. Édite `draft.naming` ; enregistré avec les réglages.
 */
export default function ProjectNamingSection({
  value,
  onChange,
}: {
  value: NamingRule;
  onChange: (n: NamingRule) => void;
}) {
  const t = useT();
  const [sample, setSample] = useState('');

  let match: boolean | null = null;
  let invalid = false;
  if (value.pattern) {
    try {
      match = new RegExp(value.pattern).test(sample);
    } catch {
      invalid = true;
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm font-medium">{t('pipeline.naming')}</div>
      <div className="mb-3 text-xs text-muted-foreground">{t('project.namingHint')}</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
          {t('naming.pattern')}
          <input
            className="w-full rounded border border-input bg-background px-2 py-1.5 font-mono text-xs"
            placeholder="^SH\d{3,}_v\d+\..+$"
            value={value.pattern}
            onChange={(e) => onChange({ ...value, pattern: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
          {t('naming.policy')}
          <select
            className="rounded border border-input bg-background px-2 py-1.5 text-xs"
            value={value.mode}
            onChange={(e) => onChange({ ...value, mode: e.target.value as NamingMode })}
          >
            {(['off', 'warn', 'reject'] as NamingMode[]).map((m) => (
              <option key={m} value={m}>
                {t(MODE_KEY[m])}
              </option>
            ))}
          </select>
        </label>
      </div>
      {value.pattern && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="w-64 rounded border border-input bg-background px-2 py-1.5 text-xs"
            placeholder={t('naming.test.placeholder')}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
          {invalid ? (
            <span className="text-xs text-destructive">{t('naming.invalidRegex')}</span>
          ) : sample ? (
            <span className={`text-xs ${match ? 'text-success' : 'text-destructive'}`}>
              {match ? 'Conforme' : 'Non conforme'}
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}
