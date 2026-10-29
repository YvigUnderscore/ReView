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
import { sanitizeHtml } from '@/v2/lib/sanitizeHtml';

/**
 * "What's new" in-app (42.B, №68): changelog fed by `DOCUMENTATION/CHANGELOG.md`
 * (served statically at /docs/CHANGELOG.md). A dot flags an unread entry;
 * opening the panel marks the latest entry as seen (localStorage).
 */
const SEEN_KEY = 'review:changelog-seen';
const CHANGELOG_URL = '/docs/CHANGELOG.md';

/**
 * Markdown rendering, loaded when the dialog opens and not before (F6).
 *
 * `docsRender` pulls in `marked`: imported at the top, it entered the **first load**
 * through the chain App → Shell → SidebarFooter → WhatsNew, i.e. 13.5 kB gzipped paid by everyone,
 * on every page, for a panel opened once a quarter. `parseChangelog`
 * is enough to decide the dot and needs nothing else.
 */
type RenderDocHtml = typeof import('../pages/docs/docsRender').renderDocHtml;

/**
 * Bytes read to decide the dot (F6, second move).
 *
 * The panel is mounted by the shell, so on **every** authenticated page, and before opening it needs
 * only one piece of information: the title of the latest entry,
 * that is the first `## ` of the file. Yet it downloaded the 24,568 bytes of the
 * changelog, uncompressed to boot, nginx serving this `.md` as
 * `application/octet-stream`, a type absent from its `gzip_types`.
 *
 * The title starts at byte 190 of the served file; 2 kB leaves ten times the margin.
 */
const HEAD_BYTES = 2048;
const HEADING_RE = /^##\s+(.+?)\s*$/;

/**
 * Key derived from `qk.changelog`: the probe and the whole document are two views of the same
 * file, they sit side by side in the cache and are invalidated together.
 */
const CHANGELOG_HEAD_KEY = [...qk.changelog, 'head'] as const;

interface ChangelogHead {
  /** Title of the latest entry (= its identifier), null if the file carries none. */
  latestId: string | null;
  /**
   * Whole document, when the server ignored `Range` and sent everything: no need then to
   * request it again on opening. Null when the response was indeed partial.
   */
  full: string | null;
}

/**
 * Identifier of the latest entry, read from the start of a file.
 *
 * `partial`: the server truncated the response, so its last line is cut in the middle:
 * we discard it rather than risk a truncated title (e.g. a heading cut to "## 2026-09 — Bande de mon").
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
   * The probe only decides a dot: it has nothing to do in the burst of the first screen,
   * where it competed for bandwidth with the page's requests (F6). It leaves when
   * the browser has nothing urgent left to do.
   */
  useEffect(() => {
    if (typeof window.requestIdleCallback !== 'function') {
      const fallback = setTimeout(() => setIdle(true), 1000);
      return () => clearTimeout(fallback);
    }
    const handle = window.requestIdleCallback(() => setIdle(true));
    return () => window.cancelIdleCallback?.(handle);
  }, []);

  // Probe: the first bytes are enough to know the latest entry.
  const { data: head } = useQuery({
    enabled: idle,
    queryKey: CHANGELOG_HEAD_KEY,
    queryFn: async (): Promise<ChangelogHead> => {
      const res = await fetch(CHANGELOG_URL, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
      if (!res.ok) throw new Error(t('whatsNew.unavailable', { status: res.status }));
      const text = await res.text();
      // 206: the server honoured `Range`. 200: it ignored it (on-the-fly compression,
      // intermediate cache) and sent everything, so we keep the document rather than
      // downloading it again on opening.
      const partial = res.status === 206;
      return { latestId: parseChangelogHead(text, partial), full: partial ? null : text };
    },
    staleTime: Infinity,
    retry: false,
  });

  // Whole document: on actual opening of the panel, and only if the probe has not
  // already fetched it.
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

  // Opening: marks the latest entry as seen (the button only exists if we know it).
  const openPanel = () => {
    setOpen(true);
    // `setState(() => fn)`: the functional form, otherwise React would call the render.
    void import('../pages/docs/docsRender').then((m) => setRenderDocHtml(() => m.renderDocHtml));
    if (!latestId) return;
    try {
      localStorage.setItem(SEEN_KEY, latestId);
    } catch {
      /* stockage indisponible */
    }
    setSeen(latestId);
  };

  // No button while no entry is known: that was already the case, but it used to be
  // decided on the file's 24 kB.
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
                    // Repo markdown (CHANGELOG.md); raw HTML is escaped by renderDocHtml.
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(renderDocHtml(e.body, 'CHANGELOG.md', calloutLabels)),
                    }}
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
