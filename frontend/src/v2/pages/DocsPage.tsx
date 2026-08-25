// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/query';
import PageShell from '../components/PageShell';
import DocsArticle from './docs/DocsArticle';
import DocsNav from './docs/DocsNav';
import { useActiveChapter } from './docs/useActiveChapter';
import { filterSections, neighbours, sectionLabel, sectionOf, type DocsManifest } from './docs/docsManifest';
import { extractChapters, renderDocHtml } from './docs/docsRender';
import { useCalloutLabels } from './docs/useCalloutLabels';
import { t, useT } from '../i18n';

/**
 * Documentation produit (/docs) : rendu du dossier DOCUMENTATION/ du repo, copié dans
 * public/docs + manifest.json par frontend/scripts/build-docs.mjs.
 *
 * Sommaire replié par section à gauche, chapitres de la page ouverte dessous, colonne de
 * lecture au centre avec ses deux pages voisines en pied. Le markdown est rendu localement.
 */

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(t('docs.unavailable', { status: res.status }));
  return res.text();
};

export default function DocsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = params.get('p') ?? 'README.md';
  const [query, setQuery] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

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

  const calloutLabels = useCalloutLabels();

  const allSections = useMemo(() => manifestQ.data?.sections ?? [], [manifestQ.data]);
  const sections = useMemo(() => filterSections(allSections, query), [allSections, query]);
  const html = useMemo(
    () => (pageQ.data ? renderDocHtml(pageQ.data, page, calloutLabels) : ''),
    [pageQ.data, page, calloutLabels],
  );
  const chapters = useMemo(() => extractChapters(html), [html]);
  const activeChapter = useActiveChapter(contentRef, chapters);

  const section = useMemo(() => sectionOf(allSections, page), [allSections, page]);
  const current = section?.pages.find((p) => p.path === page);
  const { previous, next } = useMemo(() => neighbours(allSections, page), [allSections, page]);

  const scrollToChapter = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });

  const openPage = (path: string) => {
    const [p, hash] = path.split('#');
    setParams(p === 'README.md' ? {} : { p });
    // Ancre : laisser le rendu se faire puis rejoindre le titre correspondant.
    if (hash) requestAnimationFrame(() => scrollToChapter(hash));
    else contentRef.current?.scrollTo?.(0, 0);
  };

  // Une page qui vient d'arriver commence en haut, quel que soit le défilement précédent.
  useEffect(() => {
    contentRef.current?.scrollTo?.(0, 0);
  }, [page]);

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
    <PageShell title={t('nav.documentation')} width="flush">
      <div className="flex h-full min-h-0 gap-0 pl-5">
        <DocsNav
          sections={sections}
          page={page}
          chapters={chapters}
          activeChapter={activeChapter}
          query={query}
          filtering={query.trim().length > 0}
          unavailable={manifestQ.isError}
          onQueryChange={setQuery}
          onOpenPage={openPage}
          onOpenChapter={scrollToChapter}
        />
        <DocsArticle
          page={current}
          sectionLabel={section ? sectionLabel(section, t) : ''}
          html={html}
          notFound={pageQ.isError}
          previous={previous}
          next={next}
          containerRef={contentRef}
          onOpenPage={openPage}
          onContentClick={onContentClick}
        />
      </div>
    </PageShell>
  );
}
