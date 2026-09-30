// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MouseEvent, RefObject } from 'react';
import { ChevronLeft, ChevronRight, Clock, Highlighter } from 'lucide-react';
import { intlLocale, useT } from '../../i18n';
import type { DocsPage } from './docsManifest';

/**
 * Colonne de lecture : en-tête de page (fil d'Ariane, titre, sous-titre, date), corps
 * markdown rendu, et les deux pages voisines en pied — le sommaire se lit aussi en
 * avançant page après page.
 */

/** Date de mise à jour au format du lecteur ; vide ou invalide, rien ne s'affiche. */
const formatUpdated = (iso: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(intlLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
};

function PagerLink({
  page,
  direction,
  onOpen,
}: {
  page: DocsPage;
  direction: 'previous' | 'next';
  onOpen: (path: string) => void;
}) {
  const t = useT();
  const isNext = direction === 'next';
  return (
    <button
      onClick={() => onOpen(page.path)}
      className={`group flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-secondary ${
        isNext ? 'flex-row-reverse text-right' : ''
      }`}
    >
      {isNext ? (
        <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <ChevronLeft size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span className="block text-2xs section-label text-muted-foreground">
          {t(isNext ? 'common.next' : 'common.previous')}
        </span>
        <span className="block truncate text-sm font-medium">{page.title}</span>
      </span>
    </button>
  );
}

/**
 * Ce que la recherche a trouvé **dans cette page** — la contrepartie du surlignage : sans
 * ce compte, une page ouverte sans aucune occurrence visible à l'écran laisse croire que le
 * surlignage ne marche pas.
 */
function HitCount({ hits }: { hits: number }) {
  const t = useT();
  return (
    <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted-foreground">
      <Highlighter size={12} aria-hidden="true" />
      {hits > 0 ? t('docs.hitsOnPage', { count: hits }) : t('docs.noHitOnPage')}
    </p>
  );
}

export default function DocsArticle({
  page,
  sectionLabel,
  html,
  hits,
  notFound,
  previous,
  next,
  containerRef,
  onOpenPage,
  onContentClick,
}: {
  page?: DocsPage;
  sectionLabel: string;
  html: string;
  /** Occurrences surlignées dans la page, `null` quand aucune recherche n'est en cours. */
  hits: number | null;
  notFound: boolean;
  previous?: DocsPage;
  next?: DocsPage;
  containerRef: RefObject<HTMLDivElement | null>;
  onOpenPage: (path: string) => void;
  onContentClick: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  const t = useT();
  const updated = formatUpdated(page?.updated ?? '');

  return (
    <div
      id="doc-content"
      ref={containerRef}
      role="presentation"
      className="min-w-0 flex-1 overflow-y-auto"
      /* Le clic est délégué aux liens <a data-doc> du markdown, eux-mêmes accessibles au
         clavier (Entrée déclenche un clic qui remonte ici) : le conteneur, lui, n'est pas
         un contrôle. */
      onClick={onContentClick}
    >
      {notFound ? (
        <p className="p-6 text-sm text-muted-foreground">{t('docs.pageNotFound')}</p>
      ) : (
        <div className="mx-auto max-w-3xl px-8 py-8">
          <header className="mb-8 border-b border-border pb-6">
            {sectionLabel ? (
              <p className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-2xs font-semibold section-label tracking-wider text-muted-foreground">
                {sectionLabel}
              </p>
            ) : null}
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              {page?.title ?? ''}
            </h1>
            {page?.summary ? (
              <p className="mt-2 text-base leading-7 text-muted-foreground">{page.summary}</p>
            ) : null}
            {updated ? (
              <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Clock size={12} aria-hidden="true" />
                {t('docs.updated', { date: updated })}
              </p>
            ) : null}
            {hits !== null ? <HitCount hits={hits} /> : null}
          </header>

          <article
            className="prose-doc doc-article text-foreground"
            // Markdown du repo ; le HTML brut est échappé dans renderDocHtml.
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {(previous ?? next) && (
            <nav aria-label={t('docs.pager')} className="mt-10 flex gap-3 border-t border-border pt-5">
              {previous ? (
                <PagerLink page={previous} direction="previous" onOpen={onOpenPage} />
              ) : (
                <span className="flex-1" />
              )}
              {next ? (
                <PagerLink page={next} direction="next" onOpen={onOpenPage} />
              ) : (
                <span className="flex-1" />
              )}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
