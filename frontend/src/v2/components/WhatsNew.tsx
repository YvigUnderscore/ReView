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
const CHANGELOG_URL = '/docs/CHANGELOG.md';

/**
 * Rendu du markdown, chargé à l'ouverture du dialogue et pas avant (F6).
 *
 * `docsRender` tire `marked` : importé en tête, il entrait dans le **premier chargement**
 * par la chaîne App → Shell → SidebarFooter → WhatsNew, soit 13,5 ko gzip payés par tout le
 * monde, sur toutes les pages, pour un panneau ouvert une fois par trimestre. `parseChangelog`
 * suffit à décider de la pastille et n'a besoin de rien.
 */
type RenderDocHtml = typeof import('../pages/docs/docsRender').renderDocHtml;

/**
 * Octets lus pour décider de la pastille (F6, second geste).
 *
 * Le panneau est monté par la coquille, donc sur **toute** page authentifiée, et il n'a
 * besoin avant ouverture que d'une seule information : le titre de l'entrée la plus récente,
 * c'est-à-dire le premier `## ` du fichier. Il téléchargeait pourtant les 24 568 octets du
 * changelog — non compressés de surcroît, nginx servant ce `.md` en
 * `application/octet-stream`, type absent de ses `gzip_types`.
 *
 * Le titre commence au 190e octet du fichier servi ; 2 ko laissent dix fois la marge.
 */
const HEAD_BYTES = 2048;
const HEADING_RE = /^##\s+(.+?)\s*$/;

/**
 * Clé dérivée de `qk.changelog` : la sonde et le document entier sont deux vues du même
 * fichier, elles se rangent côte à côte dans le cache et s'invalident ensemble.
 */
const CHANGELOG_HEAD_KEY = [...qk.changelog, 'head'] as const;

interface ChangelogHead {
  /** Titre de l'entrée la plus récente (= son identifiant), null si le fichier n'en porte pas. */
  latestId: string | null;
  /**
   * Document entier, quand le serveur a ignoré `Range` et a tout envoyé : inutile alors de
   * le redemander à l'ouverture. Null quand la réponse était bien partielle.
   */
  full: string | null;
}

/**
 * Identifiant de l'entrée la plus récente, lu sur un début de fichier.
 *
 * `partial` : le serveur a tronqué la réponse, sa dernière ligne est donc coupée au milieu —
 * on la jette plutôt que de risquer un titre amputé (« ## 2026-09 — Bande de mon »).
 */
function parseChangelogHead(text: string, partial: boolean): string | null {
  const lines = text.split('\n');
  if (partial) lines.pop();
  for (const line of lines) {
    const found = HEADING_RE.exec(line);
    if (found) return found[1].trim();
  }
  return null;
}

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
   * La sonde ne décide que d'une pastille : elle n'a rien à faire dans la rafale du premier
   * écran, où elle disputait la bande passante aux requêtes de la page (F6). Elle part quand
   * le navigateur n'a plus rien d'urgent à faire.
   */
  useEffect(() => {
    if (typeof window.requestIdleCallback !== 'function') {
      const fallback = setTimeout(() => setIdle(true), 1000);
      return () => clearTimeout(fallback);
    }
    const handle = window.requestIdleCallback(() => setIdle(true));
    return () => window.cancelIdleCallback?.(handle);
  }, []);

  // Sonde : les premiers octets suffisent à connaître la dernière entrée.
  const { data: head } = useQuery({
    enabled: idle,
    queryKey: CHANGELOG_HEAD_KEY,
    queryFn: async (): Promise<ChangelogHead> => {
      const res = await fetch(CHANGELOG_URL, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
      if (!res.ok) throw new Error(t('whatsNew.unavailable', { status: res.status }));
      const text = await res.text();
      // 206 : le serveur a honoré `Range`. 200 : il l'a ignoré (compression à la volée,
      // cache intermédiaire) et a tout envoyé — on garde alors le document plutôt que de le
      // retélécharger à l'ouverture.
      const partial = res.status === 206;
      return { latestId: parseChangelogHead(text, partial), full: partial ? null : text };
    },
    staleTime: Infinity,
    retry: false,
  });

  // Document entier : à l'ouverture réelle du panneau, et seulement si la sonde ne l'a pas
  // déjà ramené.
  const { data: fetched, error: fullError } = useQuery({
    enabled: open && head != null && head.full === null,
    queryKey: qk.changelog,
    queryFn: async () => {
      const res = await fetch(CHANGELOG_URL);
      if (!res.ok) throw new Error(t('whatsNew.unavailable', { status: res.status }));
      return res.text();
    },
    staleTime: Infinity,
    retry: false,
  });

  const markdown = head?.full ?? fetched ?? null;
  const entries = useMemo(() => (markdown ? parseChangelog(markdown) : []), [markdown]);
  const latestId = head?.latestId ?? null;
  const hasUnseen = latestId !== null && latestId !== seen;

  // Ouverture : marque la dernière entrée comme vue (le bouton n'existe que si on la connaît).
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

  // Pas de bouton tant qu'aucune entrée n'est connue : c'était déjà le cas, mais cela se
  // décidait sur les 24 ko du fichier.
  if (latestId === null) return null;

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
            {fullError ? (
              <p className="text-sm text-muted-foreground">{fullError.message}</p>
            ) : renderDocHtml === null || entries.length === 0 ? (
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
