import { useMemo, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { qk } from '../lib/query';
import Shell from '../components/Shell';
import { filterSections, type DocsManifest } from './docs/docsManifest';
import { renderDocHtml } from './docs/docsRender';

/**
 * Documentation produit (/docs) : rendu du dossier DOCUMENTATION/ du repo,
 * copié dans public/docs + manifest.json par frontend/scripts/build-docs.mjs.
 * Arbre latéral par section, recherche client, markdown rendu localement.
 */

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Documentation indisponible (${res.status})`);
  return res.text();
};

export default function DocsPage() {
  const [params, setParams] = useSearchParams();
  const page = params.get('p') ?? 'README.md';
  const [query, setQuery] = useState('');

  const manifestQ = useQuery({
    queryKey: qk.docsManifest(),
    queryFn: async () => JSON.parse(await fetchText('/docs/manifest.json')) as DocsManifest,
    staleTime: Infinity,
  });
  const pageQ = useQuery({
    queryKey: qk.docsPage(page),
    queryFn: () => fetchText(`/docs/${page}`),
    staleTime: Infinity,
  });

  const sections = useMemo(
    () => filterSections(manifestQ.data?.sections ?? [], query),
    [manifestQ.data, query],
  );
  const html = useMemo(() => (pageQ.data ? renderDocHtml(pageQ.data, page) : ''), [pageQ.data, page]);

  const openPage = (path: string) => {
    const [p, hash] = path.split('#');
    setParams(p === 'README.md' ? {} : { p });
    // Ancre : laisser le rendu se faire puis scroller vers l'id correspondant.
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    else document.getElementById('doc-content')?.scrollTo?.(0, 0);
  };

  // Liens internes du markdown (data-doc posé par renderDocHtml) → navigation SPA.
  const onContentClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a[data-doc]');
    const target = link?.getAttribute('data-doc');
    if (target) {
      e.preventDefault();
      openPage(target);
    }
  };

  return (
    <Shell title="Documentation">
      <div className="flex h-full min-h-0 gap-4 p-4">
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer les pages…"
              className="w-full rounded-md border border-border bg-secondary py-1.5 pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            />
          </div>
          {manifestQ.isError && (
            <p className="text-sm text-muted-foreground">
              Documentation indisponible — lancer <code>npm run dev</code> régénère
              <code> public/docs</code>.
            </p>
          )}
          {sections.map((section) => (
            <div key={section.dir}>
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.label}
              </p>
              <ul>
                {section.pages.map((p) => (
                  <li key={p.path}>
                    <button
                      onClick={() => openPage(p.path)}
                      className={`w-full truncate rounded-md px-2 py-1 text-left text-sm transition-colors ${
                        p.path === page
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      title={p.title}
                    >
                      {p.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {query.trim() && sections.length === 0 && !manifestQ.isError && (
            <p className="px-1 text-sm text-muted-foreground">Aucune page ne correspond.</p>
          )}
        </aside>

        <div
          id="doc-content"
          className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card px-6 py-4"
          onClick={onContentClick}
        >
          {pageQ.isError ? (
            <p className="text-sm text-muted-foreground">Page introuvable.</p>
          ) : (
            <article
              className="prose-doc max-w-3xl text-sm text-card-foreground"
              // Markdown du repo ; le HTML brut est échappé dans renderDocHtml.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}
