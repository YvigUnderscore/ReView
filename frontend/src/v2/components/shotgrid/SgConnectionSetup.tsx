// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ExternalLink, Loader2, Search, ShieldCheck } from 'lucide-react';
import { useT } from '../../i18n';
import { toast } from 'sonner';
import {
  useCreateSgConnection,
  useCreateSgSite,
  useSgRemoteProjects,
  useSgSites,
  useTestSgSite,
} from '../../lib/shotgridApi';
import type { SgRemoteProject } from '../../types/shotgrid';

/**
 * Création d'une connexion : choix (ou création) du site, puis désignation du projet
 * ShotGrid par son NOM.
 *
 * Le nom n'est pas un confort d'affichage. Un site de studio héberge des dizaines de
 * projets, souvent aux noms voisins (« Demo », « Demo 2 »…) : c'est le seul moment où
 * un humain confirme la cible, et le serveur revérifie que l'identifiant choisi porte
 * bien ce nom avant d'enregistrer quoi que ce soit.
 */
export default function SgConnectionSetup({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: sites = [], isLoading } = useSgSites();
  const [siteId, setSiteId] = useState<number | null>(null);
  const [creatingSite, setCreatingSite] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SgRemoteProject | null>(null);

  const testSite = useTestSgSite();
  const createConnection = useCreateSgConnection(projectId);
  const {
    data: projects = [],
    isLoading: loadingProjects,
    error: projectsError,
  } = useSgRemoteProjects(siteId, query);

  const connect = async () => {
    if (!siteId || !selected) return;
    try {
      await createConnection.mutateAsync({
        siteId,
        sgProjectId: selected.id,
        sgProjectName: selected.name,
      });
      toast.success(t('shotgrid.setup.connected', { name: selected.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('shotgrid.setup.connectFailed'));
    }
  };

  if (isLoading) return <Loader2 className="animate-spin text-muted-foreground" size={18} />;

  if (creatingSite || sites.length === 0)
    return (
      <SiteForm
        onDone={(id) => {
          setSiteId(id);
          setCreatingSite(false);
        }}
        onCancel={sites.length ? () => setCreatingSite(false) : undefined}
      />
    );

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t('shotgrid.setup.step1')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={siteId ?? ''}
            onChange={(e) => {
              setSiteId(e.target.value ? Number(e.target.value) : null);
              setSelected(null);
            }}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            aria-label={t('shotgrid.setup.siteLabel')}
          >
            <option value="">{t('shotgrid.setup.choose')}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.baseUrl}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreatingSite(true)}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
          >
            {t('shotgrid.setup.addSite')}
          </button>
          {siteId && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await testSite.mutateAsync(siteId);
                  toast.success(t('shotgrid.setup.testOk', { count: r.projectCount }));
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('shotgrid.setup.testFailed'));
                }
              }}
              disabled={testSite.isPending}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
            >
              {testSite.isPending ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <ShieldCheck size={14} />
              )}
              {t('shotgrid.setup.test')}
            </button>
          )}
        </div>
      </section>

      {siteId && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t('shotgrid.setup.step2')}</h3>
          <p className="text-xs text-muted-foreground">{t('shotgrid.setup.projectHint')}</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 text-muted-foreground" size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('shotgrid.setup.searchPlaceholder')}
              aria-label={t('shotgrid.setup.searchPlaceholder')}
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          {projectsError && (
            <p className="text-sm text-destructive">
              {projectsError instanceof Error ? projectsError.message : t('shotgrid.setup.projectsFailed')}
            </p>
          )}
          {loadingProjects ? (
            <Loader2 className="animate-spin text-muted-foreground" size={16} />
          ) : (
            <ul className="max-h-64 divide-y divide-border overflow-auto rounded-md border border-border">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-secondary/60 ${
                      selected?.id === p.id ? 'bg-secondary' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">#{p.id}</span>
                      {p.archived && (
                        <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">
                          {t('shotgrid.setup.archived')}
                        </span>
                      )}
                    </span>
                    {p.status && <span className="text-xs text-muted-foreground">{p.status}</span>}
                  </button>
                </li>
              ))}
              {projects.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted-foreground">{t('shotgrid.setup.noProject')}</li>
              )}
            </ul>
          )}
        </section>
      )}

      {selected && (
        <section className="rounded-md border border-border bg-secondary/30 p-3">
          <p className="text-sm">{t('shotgrid.setup.confirm', { name: selected.name, id: selected.id })}</p>
          <button
            type="button"
            onClick={connect}
            disabled={createConnection.isPending}
            className="mt-3 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
          >
            {createConnection.isPending && <Loader2 className="animate-spin" size={14} />}
            {t('shotgrid.setup.connect')}
          </button>
        </section>
      )}
    </div>
  );
}

/** Enregistrement d'un site ShotGrid : identifiants de script ou compte utilisateur. */
function SiteForm({ onDone, onCancel }: { onDone: (id: number) => void; onCancel?: () => void }) {
  const t = useT();
  const createSite = useCreateSgSite();
  const [authMode, setAuthMode] = useState<'script' | 'user'>('script');
  const [form, setForm] = useState({
    name: '',
    baseUrl: '',
    scriptName: '',
    scriptKey: '',
    login: '',
    password: '',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const site = await createSite.mutateAsync({
        name: form.name || form.baseUrl,
        baseUrl: form.baseUrl,
        authMode,
        ...(authMode === 'script'
          ? { scriptName: form.scriptName, scriptKey: form.scriptKey }
          : { login: form.login, password: form.password }),
      });
      toast.success(t('shotgrid.site.created'));
      onDone(site.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('shotgrid.site.createFailed'));
    }
  };

  const field = (key: keyof typeof form, label: string, type = 'text') => (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full rounded-md border border-border bg-background px-3 py-1.5"
      />
    </label>
  );

  // Une option d'authentification. Le libellé est enfant direct du <span> porteur : le texte
  // accessible du <label> doit rester à faible profondeur pour être reconnu comme tel.
  const modeOption = (value: 'script' | 'user', label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="radio" checked={authMode === value} onChange={() => setAuthMode(value)} className="mt-1" />
      <span className="font-medium">
        {label}
        <span className="block text-xs font-normal text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={submit} className="max-w-xl space-y-3">
      <h3 className="text-sm font-medium">{t('shotgrid.site.title')}</h3>
      {field('name', t('shotgrid.site.name'))}
      {field('baseUrl', t('shotgrid.site.baseUrl'))}
      <p className="text-xs text-muted-foreground">
        <code>https://studio.shotgrid.autodesk.com</code>
      </p>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm text-muted-foreground">{t('shotgrid.site.authMode')}</legend>
        {modeOption('script', t('shotgrid.site.modeScript'), t('shotgrid.site.modeScriptHint'))}
        {modeOption('user', t('shotgrid.site.modeUser'), t('shotgrid.site.modeUserHint'))}
      </fieldset>

      {authMode === 'script' ? (
        <>
          {field('scriptName', t('shotgrid.site.scriptName'))}
          {field('scriptKey', t('shotgrid.site.scriptKey'), 'password')}
        </>
      ) : (
        <>
          {field('login', t('shotgrid.site.login'))}
          {field('password', t('shotgrid.site.password'), 'password')}
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="mb-1 font-medium">{t('shotgrid.site.patTitle')}</p>
            <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
              <li>{t('shotgrid.site.patStep1')}</li>
              <li>{t('shotgrid.site.patStep2')}</li>
              <li>{t('shotgrid.site.patStep3')}</li>
            </ol>
            {form.baseUrl && (
              <a
                href={`${form.baseUrl.replace(/\/$/, '')}/page/account_settings`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-info hover:underline"
              >
                {t('shotgrid.site.patLink')} <ExternalLink size={12} />
              </a>
            )}
          </div>
        </>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={createSite.isPending}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          {createSite.isPending && <Loader2 className="animate-spin" size={14} />}
          {t('common.save')}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
