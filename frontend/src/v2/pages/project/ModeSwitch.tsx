// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../../i18n';

export type CreateMode = 'simple' | 'manual' | 'auto';

/** Sélecteur de mode de création (simple / lot manuel / génération auto). */
export default function ModeSwitch({
  mode,
  setMode,
}: {
  mode: CreateMode;
  setMode: (m: CreateMode) => void;
}) {
  const t = useT();
  const opts: { key: CreateMode; label: string }[] = [
    { key: 'simple', label: t('batch.modeSimple') },
    { key: 'manual', label: t('batch.modeBatch') },
    { key: 'auto', label: t('common.auto') },
  ];
  return (
    <div className="flex overflow-hidden rounded-md border border-border text-xs">
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => setMode(o.key)}
          className={`px-2.5 py-1 ${mode === o.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
