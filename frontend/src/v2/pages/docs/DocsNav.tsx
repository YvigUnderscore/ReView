// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { useT } from '../../i18n';
import type { DocChapter } from './docsRender';
import { slugifyHeading } from './docsRender';
import { sectionLabel, sectionOf, type DocsPage, type DocsSection } from './docsManifest';
import { matchingHeadings } from './docsSearch';
import HighlightedText from './HighlightedText';

/**
 * Sommaire de la documentation : une entrée dépliable par section, et sous la page
 * ouverte la liste de ses chapitres.
 *
 * Soixante-dix pages à plat faisaient une colonne qu'on parcourait au jugé. Repliées par
 * section, elles tiennent dans un écran ; la section courante s'ouvre seule, et le
 * chapitre lu se surligne au fil du défilement.
 *
 * Pendant une recherche, le sommaire répond comme la palette Ctrl+K : les pages trouvées
 * **par un titre de chapitre** apparaissent avec ce chapitre en dessous, cliquable — la
 * réponse n'est pas « cette page », c'est « cet endroit de cette page ».
 */

/** Chapitres de la page ouverte, suivis au défilement. */
function ChapterList({
  chapters,
  activeChapter,
  onOpenChapter,
}: {
  chapters: DocChapter[];
  activeChapter: string;
  onOpenChapter: (id: string) => void;
}) {
  return (
    <ul className="my-1 ml-2 space-y-px border-l border-border pl-2">
      {chapters.map((c) => (
        <li key={c.id}>
          <button
            onClick={() => onOpenChapter(c.id)}
            aria-current={c.id === activeChapter ? 'location' : undefined}
            className={`w-full truncate rounded px-2 py-0.5 text-left text-xs transition-colors ${
              c.id === activeChapter
                ? 'font-medium text-primary'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
            } ${c.level === 3 ? 'pl-4' : ''}`}
            title={c.text}
          >
            {c.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Chapitres qui portent la recherche — la raison du résultat, et l'endroit où entrer. */
function MatchedChapters({
  page,
  headings,
  words,
  onOpenPage,
}: {
  page: DocsPage;
  headings: string[];
  words: string[];
  onOpenPage: (path: string) => void;
}) {
  return (
    <ul className="my-1 ml-2 space-y-px border-l border-border pl-2">
      {headings.map((heading) => (
        <li key={heading}>
          <button
            onClick={() => onOpenPage(`${page.path}#${slugifyHeading(heading)}`)}
            className="w-full truncate rounded px-2 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            title={heading}
          >
            <HighlightedText text={heading} words={words} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function DocsNav({
  sections,
  page,
  chapters,
  activeChapter,
  query,
  words,
  filtering,
  unavailable,
  onQueryChange,
  onOpenPage,
  onOpenChapter,
}: {
  sections: DocsSection[];
  page: string;
  chapters: DocChapter[];
  activeChapter: string;
  query: string;
  /** Mots de la recherche, repliés — ce que l'on surligne dans les libellés. */
  words: string[];
  filtering: boolean;
  unavailable: boolean;
  onQueryChange: (value: string) => void;
  onOpenPage: (path: string) => void;
  onOpenChapter: (id: string) => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const currentDir = useMemo(() => sectionOf(sections, page)?.dir, [sections, page]);

  // Repliée par défaut, sauf l'aperçu et la section de la page ouverte. Pendant un filtre,
  // tout est ouvert : une section repliée cacherait le résultat cherché.
  const isOpen = (dir: string) => {
    if (filtering) return true;
    const closedByDefault = dir !== '' && dir !== currentDir;
    return !(collapsed[dir] ?? closedByDefault);
  };
  const toggle = (dir: string) => setCollapsed((c) => ({ ...c, [dir]: isOpen(dir) }));

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border py-4 pl-1 pr-3">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('docs.filter')}
          aria-label={t('docs.filter')}
          className="w-full rounded-lg border border-input bg-secondary/60 py-1.5 pl-8 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-secondary focus:ring-1 focus:ring-ring"
        />
        {query !== '' && (
          <button
            onClick={() => onQueryChange('')}
            aria-label={t('docs.clearSearch')}
            title={t('docs.clearSearch')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      {unavailable && (
        <p className="text-sm text-muted-foreground">
          {t('docs.buildHint')} <code>npm run dev</code> {t('client.regenerates')}
          <code> public/docs</code>.
        </p>
      )}

      <nav aria-label={t('nav.documentation')} className="flex flex-col gap-0.5">
        {sections.map((section) => {
          const open = isOpen(section.dir);
          return (
            <div key={section.dir}>
              <button
                onClick={() => toggle(section.dir)}
                aria-expanded={open}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-2xs font-semibold section-label tracking-wider text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ChevronRight
                  size={12}
                  className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
                <span className="truncate">{sectionLabel(section, t)}</span>
                <span className="ml-auto rounded-full bg-secondary px-1.5 tabular-nums text-muted-foreground">
                  {section.pages.length}
                </span>
              </button>

              {open && (
                <ul className="mb-1 ml-[13px] border-l border-border pl-1.5">
                  {section.pages.map((p) => {
                    const active = p.path === page;
                    const matched = filtering ? matchingHeadings(p, words) : [];
                    return (
                      <li key={p.path} className="relative">
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute -left-[7px] bottom-1 top-1 w-0.5 rounded-full bg-primary"
                          />
                        )}
                        <button
                          onClick={() => onOpenPage(p.path)}
                          aria-current={active ? 'page' : undefined}
                          className={`w-full truncate rounded-md px-2 py-1 text-left text-sm transition-colors ${
                            active
                              ? 'bg-secondary font-medium text-foreground'
                              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                          }`}
                          title={p.summary || p.title}
                        >
                          <HighlightedText text={p.title} words={words} />
                        </button>
                        {matched.length > 0 && (
                          <MatchedChapters
                            page={p}
                            headings={matched}
                            words={words}
                            onOpenPage={onOpenPage}
                          />
                        )}
                        {active && !filtering && chapters.length > 0 && (
                          <ChapterList
                            chapters={chapters}
                            activeChapter={activeChapter}
                            onOpenChapter={onOpenChapter}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {filtering && sections.length === 0 && !unavailable && (
        <p className="px-1 text-sm text-muted-foreground">{t('docs.noMatch')}</p>
      )}
    </aside>
  );
}
