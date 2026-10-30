// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { useT } from '../../i18n';
import { useUpdateSgConnection } from '../../lib/shotgridApi';
import { useSgSteps } from '../../lib/shotgridTasksApi';
import type { SgConnection } from '../../types/shotgrid';

/**
 * Pipeline stages kept for this project.
 *
 * ShotGrid only offers, in its own menus, the stages whose visibility is enabled on the
 * project, but it does not publish that setting anywhere: no entity, no project field on
 * `Step`, no value list in the schema. The studio therefore declares here what its site
 * knows without saying so, once, and ReView sticks to it.
 *
 * Ticking nothing is not an error: stages are then inferred from the tasks already in the
 * project, and failing that the site catalogue is offered.
 */
export default function SgStepsPanel({
  connection,
  canManage,
}: {
  connection: SgConnection;
  canManage: boolean;
}) {
  const t = useT();
  const update = useUpdateSgConnection(connection.projectId);
  const [kind, setKind] = useState<'asset' | 'shot'>('asset');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // The full catalogue: this is the one place, and the only one, where everything must be visible.
  const { data: steps = [], isLoading } = useSgSteps(
    connection.projectId,
    kind === 'asset' ? 'Asset' : 'Shot',
    true,
    { all: true },
  );

  const selected = new Set(connection.settings.steps?.[kind] ?? []);

  const toggle = async (sgId: number) => {
    if (!canManage) return;
    const next = new Set(selected);
    if (next.has(sgId)) next.delete(sgId);
    else next.add(sgId);
    setSaving(true);
    try {
      await update.mutateAsync({
        settings: { steps: { ...connection.settings.steps, [kind]: [...next] } },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setSaving(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const shown = steps.filter(
    (s) => !needle || s.code.toLowerCase().includes(needle) || s.shortName.toLowerCase().includes(needle),
  );

  return (
    <section className="space-y-2">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{t('shotgrid.steps.title')}</h3>
        {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
        <span className="text-xs text-muted-foreground">
          {t('shotgrid.steps.count', { count: selected.size })}
        </span>
      </header>
      <p className="text-xs text-muted-foreground">{t('shotgrid.steps.hint')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('shotgrid.steps.kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as 'asset' | 'shot')}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          <option value="asset">{t('shotgrid.steps.forAssets')}</option>
          <option value="shot">{t('shotgrid.steps.forShots')}</option>
        </select>
        <label className="flex flex-1 items-center gap-2 rounded-md border border-input bg-background px-2">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('shotgrid.steps.search')}
            aria-label={t('shotgrid.steps.search')}
            className="w-full bg-transparent py-1 text-sm"
          />
        </label>
      </div>

      {isLoading ? (
        <Loader2 className="animate-spin text-muted-foreground" size={16} />
      ) : (
        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
          {shown.map((step) => (
            <label
              key={step.sgId}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary/50"
            >
              <input
                type="checkbox"
                checked={selected.has(step.sgId)}
                disabled={!canManage || saving}
                onChange={() => void toggle(step.sgId)}
              />
              {step.color && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: step.color }} />
              )}
              <span className="min-w-0 flex-1 truncate">{step.code}</span>
              {/* The short code is shown even when it repeats the name: it is what tells apart
                  two stages with the same name, and there is no other marker. */}
              {step.shortName && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{step.shortName}</span>
              )}
              {step.used && (
                <span className="shrink-0 text-2xs text-muted-foreground">{t('shotgrid.steps.inUse')}</span>
              )}
            </label>
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('shotgrid.steps.empty')}</p>
          )}
        </div>
      )}
    </section>
  );
}
