// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ExternalLink, Loader2, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n';
import {
  useDeleteSgSite,
  useSgSites,
  useTestSgSite,
  useUpdateSgSite,
  type SiteFormInput,
} from '../../lib/shotgridApi';
import type { SgSite } from '../../types/shotgrid';

/**
 * Sites ShotGrid du studio (administration globale).
 *
 * Les identifiants vivent ici, pas dans chaque projet : une paire créée une fois sert
 * à toutes les connexions du studio, et une rotation de clé se fait en un endroit.
 * Aucun secret n'est jamais renvoyé par l'API — les champs restent vides à l'édition,
 * et ne remplacer que ce qu'on saisit.
 */
export default function ShotgridSitesTab() {
  const t = useT();
  const { data: sites = [], isLoading } = useSgSites();
  const testSite = useTestSgSite();
  const deleteSite = useDeleteSgSite();
  const [editing, setEditing] = useState<number | null>(null);

  if (isLoading) return <Loader2 className="animate-spin text-muted-foreground" size={18} />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">{t('shotgrid.admin.title')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('shotgrid.admin.intro')}</p>
      </div>

      {sites.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          {t('shotgrid.admin.empty')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.site.name')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.site.baseUrl')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.site.authMode')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('shotgrid.admin.projects')}</th>
                <th className="w-32 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sites.map((site) => (
                <tr key={site.id}>
                  <td className="px-3 py-2">{site.name}</td>
                  <td className="px-3 py-2">
                    <a
                      href={site.baseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs hover:underline"
                    >
                      {site.baseUrl} <ExternalLink size={11} />
                    </a>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {site.authMode === 'script'
                      ? `${t('shotgrid.site.modeScript')} · ${site.scriptName ?? '—'}`
                      : `${t('shotgrid.site.modeUser')} · ${site.login ?? '—'}`}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {t('shotgrid.admin.linkedProjects', { count: site.connectionCount ?? 0 })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const r = await testSite.mutateAsync(site.id);
                            toast.success(t('shotgrid.setup.testOk', { count: r.projectCount }));
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : t('shotgrid.setup.testFailed'));
                          }
                        }}
                        className="rounded border border-border p-1.5 hover:bg-secondary/60"
                        title={t('shotgrid.setup.test')}
                      >
                        <ShieldCheck size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(editing === site.id ? null : site.id)}
                        className="rounded border border-border p-1.5 hover:bg-secondary/60"
                        title={t('common.edit')}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(t('shotgrid.admin.deleteConfirm', { name: site.name }))) return;
                          try {
                            await deleteSite.mutateAsync(site.id);
                            toast.success(t('shotgrid.admin.deleted'));
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : t('common.error.generic'));
                          }
                        }}
                        className="rounded border border-border p-1.5 hover:bg-destructive/10 hover:text-destructive"
                        title={t('common.delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <EditSite site={sites.find((s) => s.id === editing)!} onDone={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Rotation des identifiants d'un site : laisser vide conserve la valeur en place. */
function EditSite({ site, onDone }: { site: SgSite; onDone: () => void }) {
  const t = useT();
  const update = useUpdateSgSite();
  const [form, setForm] = useState({
    name: site.name,
    scriptName: site.scriptName ?? '',
    scriptKey: '',
    login: site.login ?? '',
    password: '',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch: Partial<SiteFormInput> & { id: number } = { id: site.id, name: form.name };
    if (site.authMode === 'script') {
      patch.scriptName = form.scriptName;
      if (form.scriptKey) patch.scriptKey = form.scriptKey;
    } else {
      patch.login = form.login;
      if (form.password) patch.password = form.password;
    }
    try {
      await update.mutateAsync(patch);
      toast.success(t('shotgrid.admin.updated'));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <form onSubmit={submit} className="max-w-lg space-y-3 rounded-md border border-border p-4">
      <h3 className="text-sm font-medium">{t('shotgrid.admin.editTitle', { name: site.name })}</h3>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">{t('shotgrid.site.name')}</span>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5"
        />
      </label>
      {site.authMode === 'script' ? (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t('shotgrid.site.scriptName')}</span>
            <input
              value={form.scriptName}
              onChange={(e) => setForm({ ...form, scriptName: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t('shotgrid.site.scriptKey')}</span>
            <input
              type="password"
              value={form.scriptKey}
              placeholder={t('shotgrid.admin.keepSecret')}
              aria-label={t('shotgrid.admin.keepSecret')}
              onChange={(e) => setForm({ ...form, scriptKey: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5"
            />
          </label>
        </>
      ) : (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t('shotgrid.site.login')}</span>
            <input
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t('shotgrid.site.password')}</span>
            <input
              type="password"
              value={form.password}
              placeholder={t('shotgrid.admin.keepSecret')}
              aria-label={t('shotgrid.admin.keepSecret')}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5"
            />
          </label>
        </>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={update.isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
