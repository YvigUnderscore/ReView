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
 * Étapes de pipeline retenues pour ce projet.
 *
 * ShotGrid ne propose, dans ses propres menus, que les étapes dont la visibilité est
 * activée sur le projet — mais il ne publie ce réglage nulle part : ni entité, ni champ
 * de projet sur `Step`, ni liste de valeurs dans le schéma. Le studio déclare donc ici ce
 * que son site sait sans le dire, une fois, et ReView s'y tient.
 *
 * Ne rien cocher n'est pas une erreur : on déduit alors les étapes des tasks déjà
 * présentes dans le projet, et à défaut on propose le catalogue du site.
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

  // Le catalogue entier : c'est ici, et seulement ici, qu'on veut tout voir.
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
              {/* Le code court est affiché même quand il répète le nom : c'est lui qui
                  départage deux étapes homonymes, et il n'y a pas d'autre repère. */}
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
