// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import { MATCH_EFFECT, MATCH_EXAMPLE, MATCH_LABEL } from './visibilityLabels';
import { useT } from '../../i18n';

/**
 * How to write a pattern, in three examples.
 *
 * The regular expression is the only one of the four forms that can go wrong, and it is
 * also the one that serves the studio with a naming convention. Pointing it to the
 * documentation would have meant nobody uses it: the help therefore lives where one
 * writes the rule, collapsed by default so as not to clutter those who already know.
 */
export default function VisibilityHelp() {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-md border border-border bg-secondary/20">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <HelpCircle size={14} />
        {t('visibility.help.title')}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
          <p>{t('visibility.help.lead')}</p>
          <dl className="space-y-1.5">
            {(['exact', 'prefix', 'contains', 'regex'] as const).map((kind) => (
              <div key={kind} className="flex flex-wrap items-baseline gap-2">
                <dt className="w-24 shrink-0 font-medium text-foreground">{t(MATCH_LABEL[kind])}</dt>
                <dd className="flex flex-wrap items-baseline gap-2">
                  <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                    {t(MATCH_EXAMPLE[kind])}
                  </code>
                  <span>{t(MATCH_EFFECT[kind])}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-border pt-2">{t('visibility.help.footer')}</p>
        </div>
      )}
    </section>
  );
}
