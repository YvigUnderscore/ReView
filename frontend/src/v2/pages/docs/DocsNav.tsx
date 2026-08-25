// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { useT } from '../../i18n';
import type { DocChapter } from './docsRender';
import { sectionLabel, sectionOf, type DocsSection } from './docsManifest';

/**
 * Sommaire de la documentation : une entrée dépliable par section, et sous la page
 * ouverte la liste de ses chapitres.
 *
 * Soixante-dix pages à plat faisaient une colonne qu'on parcourait au jugé. Repliées par
 * section, elles tiennent dans un écran ; la section courante s'ouvre seule, et le
 * chapitre lu se surligne au fil du défilement.
 */
export default function DocsNav({
  sections,
  page,
  chapters,
  activeChapter,
  query,
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
          className="w-full rounded-md border border-border bg-secondary py-1.5 pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        />
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
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ChevronRight
                  size={12}
                  className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
                <span className="truncate">{sectionLabel(section, t)}</span>
                <span className="ml-auto tabular-nums opacity-60">{section.pages.length}</span>
              </button>

              {open && (
                <ul className="mb-1 ml-[13px] border-l border-border pl-1.5">
                  {section.pages.map((p) => {
                    const active = p.path === page;
                    return (
                      <li key={p.path}>
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
                          {p.title}
                        </button>
                        {active && chapters.length > 0 && (
                          <ul className="my-1 ml-2 border-l border-border pl-2">
                            {chapters.map((c) => (
                              <li key={c.id}>
                                <button
                                  onClick={() => onOpenChapter(c.id)}
                                  className={`w-full truncate rounded px-2 py-0.5 text-left text-xs transition-colors ${
                                    c.id === activeChapter
                                      ? 'text-primary'
                                      : 'text-muted-foreground hover:text-foreground'
                                  } ${c.level === 3 ? 'pl-4' : ''}`}
                                  title={c.text}
                                >
                                  {c.text}
                                </button>
                              </li>
                            ))}
                          </ul>
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
