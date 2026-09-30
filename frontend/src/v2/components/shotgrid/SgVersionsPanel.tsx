// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import { useImportVersions, useSgImportableVersions } from '../../lib/shotgridApi';

/**
 * Publishes ShotGrid du projet : ce qui est déjà dans ReView et ce qui peut y entrer.
 * L'import automatique couvre les nouveaux ; cette table sert à rattraper l'historique
 * ou à récupérer un publish exclu par le filtre de statuts.
 */
export default function SgVersionsPanel({ projectId, canManage }: { projectId: number; canManage: boolean }) {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const { data = [], isLoading, refetch } = useSgImportableVersions(projectId, enabled);
  const importVersions = useImportVersions(projectId);
  const [selected, setSelected] = useState<number[]>([]);

  const toggle = (sgId: number) =>
    setSelected((prev) => (prev.includes(sgId) ? prev.filter((i) => i !== sgId) : [...prev, sgId]));

  const runImport = async () => {
    try {
      await importVersions.mutateAsync(selected);
      toast.success(t('shotgrid.versions.imported', { count: selected.length }));
      setSelected([]);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  if (!enabled)
    return (
      <div className="rounded-md border border-border p-4 text-center">
        <p className="mb-3 text-sm text-muted-foreground">{t('shotgrid.versions.intro')}</p>
        <button
          type="button"
          onClick={() => setEnabled(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          {t('shotgrid.versions.load')}
        </button>
      </div>
    );

  if (isLoading) return <Loader2 className="animate-spin text-muted-foreground" size={16} />;

  const pending = data.filter((v) => !v.imported);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t('shotgrid.versions.summary', { total: data.length, pending: pending.length })}
        </span>
        {canManage && selected.length > 0 && (
          <button
            type="button"
            onClick={runImport}
            disabled={importVersions.isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
          >
            {importVersions.isPending ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <Download size={14} />
            )}
            {t('shotgrid.versions.importSelected', { count: selected.length })}
          </button>
        )}
        {canManage && pending.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected(pending.map((v) => v.sgId))}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
          >
            {t('shotgrid.versions.selectAllPending')}
          </button>
        )}
      </div>

      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-secondary/60 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left font-medium">{t('shotgrid.versions.code')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('shotgrid.versions.entity')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('shotgrid.versions.status')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('shotgrid.versions.author')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('shotgrid.versions.state')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((v) => (
              <tr key={v.sgId} className={v.imported ? 'opacity-60' : ''}>
                <td className="px-2 py-1.5 text-center">
                  {!v.imported && canManage && (
                    <input
                      type="checkbox"
                      checked={selected.includes(v.sgId)}
                      onChange={() => toggle(v.sgId)}
                      aria-label={t('shotgrid.versions.selectAria', { code: v.code })}
                    />
                  )}
                </td>
                <td className="px-3 py-1.5">{v.code}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {v.entity ?? '—'} {v.task ? `· ${v.task}` : ''}
                </td>
                <td className="px-3 py-1.5 text-xs">{v.status ?? '—'}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{v.user ?? '—'}</td>
                <td className="px-3 py-1.5 text-xs">
                  {v.imported ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <Check size={12} /> {t('shotgrid.versions.alreadyIn')}
                    </span>
                  ) : v.hasMedia ? (
                    <span className="text-muted-foreground">{t('shotgrid.versions.hasMedia')}</span>
                  ) : (
                    <span className="text-muted-foreground">{t('shotgrid.versions.noMedia')}</span>
                  )}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {t('shotgrid.versions.none')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
