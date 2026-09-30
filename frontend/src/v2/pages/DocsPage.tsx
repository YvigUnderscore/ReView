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
import { neighbours, sectionLabel, sectionOf } from './docs/docsManifest';
import { docWords, filterSections } from './docs/docsSearch';
import { MIN_HIGHLIGHT_WORD, highlightDocHtml } from './docs/docsHighlight';
import { useDocsManifest } from './docs/useDocsManifest';
import { extractChapters, renderDocHtml } from './docs/docsRender';
import { useCalloutLabels } from './docs/useCalloutLabels';
import { t, useT } from '../i18n';

/**
 * Documentation produit (/docs) : rendu du dossier DOCUMENTATION/ du repo, copié dans
 * public/docs + manifest.json par frontend/scripts/build-docs.mjs.
 *
 * Sommaire replié par section à gauche, chapitres de la page ouverte dessous, colonne de
 * lecture au centre avec ses deux pages voisines en pied. Le markdown est rendu localement.
 *
 * La recherche est la même que celle de la palette Ctrl+K (`docs/docsSearch`) : elle porte
 * sur les titres de chapitre autant que sur les titres de page, dit quel chapitre répond, et
 * **surligne le terme dans la page ouverte** (`docs/docsHighlight`), qu'on rejoint sur sa
 * première occurrence.
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
  // Ancre demandée par un lien ou un chapitre d'une AUTRE page : elle ne peut être rejointe
  // qu'une fois cette page rendue, ce qui suppose d'attendre son chargement.
  const pendingAnchor = useRef<string | null>(null);

  const manifestQ = useDocsManifest();
  const pageQ = useQuery({
    queryKey: qk.docsPage(page),
    queryFn: () => fetchText(`/docs/${page}`),
    staleTime: Infinity,
  });

  const calloutLabels = useCalloutLabels();

  const allSections = useMemo(() => manifestQ.data?.sections ?? [], [manifestQ.data]);
  const sections = useMemo(() => filterSections(allSections, query), [allSections, query]);
  const words = useMemo(() => docWords(query).filter((word) => word.length >= MIN_HIGHLIGHT_WORD), [query]);

  const rendered = useMemo(
    () => (pageQ.data ? renderDocHtml(pageQ.data, page, calloutLabels) : ''),
    [pageQ.data, page, calloutLabels],
  );
  const { html, count: hits } = useMemo(() => highlightDocHtml(rendered, query), [rendered, query]);
  // Les chapitres se lisent sur le rendu nu : le surlignage n'ajoute que des <mark> dans le
  // texte des titres, mais recalculer la liste à chaque frappe ferait clignoter le sommaire.
  const chapters = useMemo(() => extractChapters(rendered), [rendered]);
  const activeChapter = useActiveChapter(contentRef, chapters);

  const section = useMemo(() => sectionOf(allSections, page), [allSections, page]);
  const current = section?.pages.find((p) => p.path === page);
  const { previous, next } = useMemo(() => neighbours(allSections, page), [allSections, page]);

  const scrollToChapter = (id: string) => document.getElementById(id)?.scrollIntoView?.({ block: 'start' });

  const openPage = (path: string) => {
    const [target, hash] = path.split('#');
    const samePage = target === page;
    setParams(target === 'README.md' ? {} : { p: target });
    if (!hash) {
      if (!samePage) contentRef.current?.scrollTo?.(0, 0);
      return;
    }
    if (samePage) scrollToChapter(hash);
    else pendingAnchor.current = hash;
  };

  // Une page qui vient d'arriver commence en haut, quel que soit le défilement précédent.
  useEffect(() => {
    contentRef.current?.scrollTo?.(0, 0);
  }, [page]);

  // Page rendue : on rejoint l'ancre demandée, à défaut la première occurrence surlignée —
  // chercher un mot doit mener au mot, pas au haut d'une page de quarante paragraphes.
  useEffect(() => {
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (anchor) {
      scrollToChapter(anchor);
      return;
    }
    if (hits > 0) document.querySelector('[data-doc-hit="first"]')?.scrollIntoView?.({ block: 'center' });
  }, [html, hits]);

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
          words={words}
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
          hits={query.trim().length > 0 ? hits : null}
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
