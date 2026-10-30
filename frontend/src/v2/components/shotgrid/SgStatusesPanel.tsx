// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { useT } from '../../i18n';
import { usePipelineStatuses, useUpdateSgConnection } from '../../lib/shotgridApi';
import type { SgConnection, StatusScope } from '../../types/shotgrid';

const SCOPES: readonly StatusScope[] = ['task', 'shot', 'sequence', 'asset'];

/**
 * Statuses kept for this project, scope by scope.
 *
 * A studio site offers twenty-one plan statuses; a production uses only six. All twenty-one
 * showed up in every context menu, every filter and every dropdown, and you had to read them
 * all to find the one you needed. The studio therefore declares here the ones it wants to
 * see, just as it declares its stages.
 *
 * Ticking nothing is not an error: the scope then stays complete. And hiding does not
 * erase anything: sync keeps importing an entity's real status, and a plan already marked
 * "on hold" keeps its badge. Only the choice is reduced.
 */
export default function SgStatusesPanel({
  connection,
  canManage,
}: {
  connection: SgConnection;
  canManage: boolean;
}) {
  const t = useT();
  const update = useUpdateSgConnection(connection.projectId);
  const [scope, setScope] = useState<StatusScope>('shot');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // The full catalogue: this is the one place, and the only one, where everything must be
  // visible. Ticking items in a list already trimmed by itself would make it impossible to get back.
  const { data: statuses = [], isLoading } = usePipelineStatuses(scope, connection.projectId, {
    all: true,
  });

  const selected = new Set(connection.settings.visibleStatuses?.[scope] ?? []);

  const toggle = async (code: string) => {
    if (!canManage) return;
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setSaving(true);
    try {
      await update.mutateAsync({
        settings: { visibleStatuses: { ...connection.settings.visibleStatuses, [scope]: [...next] } },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setSaving(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const shown = statuses.filter(
    (s) => !needle || s.code.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle),
  );

  return (
    <section className="space-y-2">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{t('shotgrid.statuses.title')}</h3>
        {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
        <span className="text-xs text-muted-foreground">
          {selected.size === 0
            ? t('shotgrid.statuses.all')
            : t('shotgrid.statuses.count', { count: selected.size })}
        </span>
      </header>
      <p className="text-xs text-muted-foreground">{t('shotgrid.statuses.hint')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('shotgrid.statuses.scopeLabel')}
          value={scope}
          onChange={(e) => setScope(e.target.value as StatusScope)}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          {SCOPES.map((key) => (
            <option key={key} value={key}>
              {t(`shotgrid.statuses.scope.${key}` as never)}
            </option>
          ))}
        </select>
        <label className="flex flex-1 items-center gap-2 rounded-md border border-input bg-background px-2">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('shotgrid.statuses.search')}
            aria-label={t('shotgrid.statuses.search')}
            className="w-full bg-transparent py-1 text-sm"
          />
        </label>
      </div>

      {isLoading ? (
        <Loader2 className="animate-spin text-muted-foreground" size={16} />
      ) : (
        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
          {shown.map((status) => (
            <label
              key={status.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary/50"
            >
              <input
                type="checkbox"
                checked={selected.has(status.code)}
                disabled={!canManage || saving}
                onChange={() => void toggle(status.code)}
              />
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
              <span className="min-w-0 flex-1 truncate">{status.name}</span>
              {/* The code is what the site writes in `sg_status_list`: it is what tells apart two
                  statuses with the same name, and the only stable marker. */}
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{status.code}</span>
            </label>
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('shotgrid.statuses.empty')}</p>
          )}
        </div>
      )}
    </section>
  );
}
