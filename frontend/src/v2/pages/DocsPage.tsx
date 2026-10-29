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
 * Product documentation (/docs): renders the DOCUMENTATION/ folder of the repo, copied into
 * public/docs + manifest.json by frontend/scripts/build-docs.mjs.
 *
 * Summary folded per section on the left, chapters of the open page below it, reading column
 * in the centre with its two neighbouring pages at the foot. The markdown is rendered locally.
 *
 * Search is the same as the Ctrl+K palette's (`docs/docsSearch`): it covers
 * chapter titles as well as page titles, says which chapter answers, and
 * **highlights the term in the open page** (`docs/docsHighlight`), jumping to its
 * first occurrence.
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
  // Anchor requested by a link or a chapter of ANOTHER page: it can only be reached
  // once that page has rendered, which means waiting for its load.
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
  // Chapters are read on the bare render: highlighting only adds <mark> tags in the
  // text of the titles, but recomputing the list on each keystroke would make the summary flicker.
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

  // A page that has just arrived starts at the top, whatever the previous scroll.
  useEffect(() => {
    contentRef.current?.scrollTo?.(0, 0);
  }, [page]);

  // Page rendered: we jump to the requested anchor, otherwise the first highlighted occurrence —
  // searching for a word must lead to the word, not to the top of a forty-paragraph page.
  useEffect(() => {
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (anchor) {
      scrollToChapter(anchor);
      return;
    }
    if (hits > 0) document.querySelector('[data-doc-hit="first"]')?.scrollIntoView?.({ block: 'center' });
  }, [html, hits]);

  // Internal markdown links (data-doc set by renderDocHtml) → SPA navigation.
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
