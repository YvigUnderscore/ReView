// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { qk } from '../lib/query';
import { parseChangelog } from '../lib/changelog';
import { useCalloutLabels } from '../pages/docs/useCalloutLabels';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { useT } from '../i18n';

/**
 * « Nouveautés » in-app (42.B — №68) : changelog alimenté par `DOCUMENTATION/CHANGELOG.md`
 * (servi statiquement sur /docs/CHANGELOG.md). Une pastille signale une entrée non lue ;
 * l'ouverture marque la dernière entrée comme vue (localStorage).
 */
const SEEN_KEY = 'review:changelog-seen';

/**
 * Rendu du markdown, chargé à l'ouverture du dialogue et pas avant (F6).
 *
 * `docsRender` tire `marked` : importé en tête, il entrait dans le **premier chargement**
 * par la chaîne App → Shell → SidebarFooter → WhatsNew, soit 13,5 ko gzip payés par tout le
 * monde, sur toutes les pages, pour un panneau ouvert une fois par trimestre. `parseChangelog`
 * suffit à décider de la pastille et n'a besoin de rien.
 */
type RenderDocHtml = typeof import('../pages/docs/docsRender').renderDocHtml;

export default function WhatsNew({ collapsed }: { collapsed?: boolean }) {
  const t = useT();
  const calloutLabels = useCalloutLabels();
  const [open, setOpen] = useState(false);
  const [renderDocHtml, setRenderDocHtml] = useState<RenderDocHtml | null>(null);
  const [idle, setIdle] = useState(false);
  const [seen, setSeen] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SEEN_KEY);
    } catch {
      return null;
    }
  });

  /**
   * Le changelog ne décide que d'une pastille : il n'a rien à faire dans la rafale du
   * premier écran, où il disputait la bande passante aux requêtes de la page (F6). Il part
   * quand le navigateur n'a plus rien d'urgent à faire.
   */
  useEffect(() => {
    if (typeof window.requestIdleCallback !== 'function') {
      const fallback = setTimeout(() => setIdle(true), 1000);
      return () => clearTimeout(fallback);
    }
    const handle = window.requestIdleCallback(() => setIdle(true));
    return () => window.cancelIdleCallback?.(handle);
  }, []);

  const { data } = useQuery({
    enabled: idle,
    queryKey: qk.changelog,
    queryFn: async () => {
      const res = await fetch('/docs/CHANGELOG.md');
      if (!res.ok) throw new Error(t('whatsNew.unavailable', { status: res.status }));
      return res.text();
    },
    staleTime: Infinity,
    retry: false,
  });

  const entries = useMemo(() => (data ? parseChangelog(data) : []), [data]);
  const latestId = entries[0]?.id ?? null;
  const hasUnseen = latestId !== null && latestId !== seen;

  // Ouverture : marque la dernière entrée comme vue (le bouton n'existe que si data est chargée).
  const openPanel = () => {
    setOpen(true);
    // `setState(() => fn)` : la forme fonctionnelle, sinon React appellerait le rendu.
    void import('../pages/docs/docsRender').then((m) => setRenderDocHtml(() => m.renderDocHtml));
    if (!latestId) return;
    try {
      localStorage.setItem(SEEN_KEY, latestId);
    } catch {
      /* stockage indisponible */
    }
    setSeen(latestId);
  };

  if (entries.length === 0) return null;

  return (
    <>
      <button
        onClick={openPanel}
        title={t('whatsNew.title')}
        aria-label={t('whatsNew.title')}
        className="relative flex items-center gap-2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Sparkles size={14} />
        {!collapsed && <span className="text-xs">{t('whatsNew.title')}</span>}
        {hasUnseen && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent-2" aria-hidden />
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('whatsNew.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {renderDocHtml === null ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : (
              entries.map((e) => (
                <div key={e.id}>
                  <p className="mb-2 text-xs font-semibold section-label text-primary">{e.id}</p>
                  <article
                    className="prose-doc max-w-none text-sm text-card-foreground"
                    // Markdown du repo (CHANGELOG.md) ; le HTML brut est échappé par renderDocHtml.
                    dangerouslySetInnerHTML={{ __html: renderDocHtml(e.body, 'CHANGELOG.md', calloutLabels) }}
                  />
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
