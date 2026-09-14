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
 * Statuts retenus pour ce projet, périmètre par périmètre.
 *
 * Un site de studio propose vingt et un statuts de plan ; une production n'en emploie
 * que six. Les vingt et un se retrouvaient dans chaque menu contextuel, chaque filtre,
 * chaque liste déroulante — et il fallait tous les lire pour trouver celui du jour.
 * Le studio déclare donc ici ceux qu'il veut voir, comme il déclare ses étapes.
 *
 * Ne rien cocher n'est pas une erreur : le périmètre reste alors entier. Et masquer
 * n'efface rien — la synchronisation continue d'importer le statut réel d'une entité,
 * le badge d'un plan déjà « on hold » reste juste. Seul le choix est réduit.
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

  // Le catalogue entier : c'est ici, et seulement ici, qu'on veut tout voir — cocher
  // dans une liste déjà amputée d'elle-même ne permettrait plus d'y revenir.
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
              {/* Le code est ce que le site écrit dans `sg_status_list` : c'est lui qui
                  départage deux statuts de même nom, et le seul repère stable. */}
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
