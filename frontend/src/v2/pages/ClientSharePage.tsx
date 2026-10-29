// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { clientApi, setShareAuth, ClientApiError } from './client/clientApi';
import ClientBrowse from './client/ClientBrowse';
import LanguagePicker from '../components/LanguagePicker';
import ClientMediaViewer from './client/ClientMediaViewer';
import { parseClientMediaId, parseClientView, viewParams, type ClientView } from './client/clientBrowseModel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import SourceNotice from '../components/SourceNotice';
import type { ClientSharePayload } from '../types/api';
import { useT } from '../i18n';
import { intlLocale } from '../i18n';

/**
 * Public client page (35.D): access via share link, studio styling, playback,
 * annotation and comments — zero navigation to the app.
 *
 * Arrival is a **home**: the playlists the link opens, then the latest
 * deliveries; the rest is browsed through four tabs (Review, Sequences, Shots, Assets).
 * Where one is lives in the URL, as on the project page: the browser's Back button
 * works, and a client can send a colleague the link to the shot they are
 * talking about — without giving more than the scope allows, since it is the same token.
 */
export default function ClientSharePage() {
  const t = useT();
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const payloadQ = useQuery({
    queryKey: ['client-share', token],
    queryFn: async () => {
      const p = await clientApi.get<ClientSharePayload>(token);
      if (p.shareAuth) setShareAuth(token, p.shareAuth);
      return p;
    },
    retry: false,
    staleTime: 60 * 1000,
  });
  const p = payloadQ.data;

  const view = parseClientView(params);
  const openedId = parseClientMediaId(params);
  const setView = (next: ClientView, mediaId?: number | null) =>
    setParams(viewParams(next, mediaId), { replace: false });

  if (payloadQ.error) {
    const err = payloadQ.error;
    return (
      <ClientFrame studio={null}>
        <p className="text-center text-sm text-muted-foreground">
          {err instanceof ClientApiError && err.status === 410 ? t('share.viewLimit') : t('share.invalid')}
        </p>
      </ClientFrame>
    );
  }
  if (!p) {
    return (
      <ClientFrame studio={null}>
        <p className="text-center text-sm text-muted-foreground">{t('common.loading')}</p>
      </ClientFrame>
    );
  }
  if (p.locked) {
    return (
      <ClientFrame studio={p.studio}>
        <PasswordGate
          token={token}
          onUnlocked={() => qc.invalidateQueries({ queryKey: ['client-share', token] })}
        />
      </ClientFrame>
    );
  }

  const media = p.media ?? [];
  const opened = openedId === null ? null : (media.find((m) => m.id === openedId) ?? null);
  // The label fallback is shown in the watermark: it goes through `t()` like the rest
  // (it was hard-coded in French — the AST detector does not read inside templates).
  const watermarkText = p.watermark?.enabled
    ? `${p.label ?? t('client.review')} — ${p.studio.name} — ${new Date().toLocaleDateString(intlLocale())}`
    : null;

  return (
    // `h-full` rather than `min-h-screen`: `#root` is `height: 100%; overflow: hidden`
    // (index.css) — the internal application manages its own scrolling. A page that grows
    // under this lock overflows with nothing able to scroll: everything that fell below the
    // fold was simply unreachable. The shell therefore keeps the window's height,
    // header and footer fixed, and it is the CENTRE that scrolls.
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        {p.studio.logoUrl ? (
          <img src={p.studio.logoUrl} alt={p.studio.name} className="h-8 w-auto" />
        ) : (
          <span className="text-base font-semibold">{p.studio.name}</span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{p.project?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{p.label ?? t('client.review')}</p>
        </div>
        {/* The portal starts in English (see `isSharePath`) — the selector is what makes
            that choice acceptable: it is offered straight away, and the language chosen is kept. */}
        <LanguagePicker className="ml-auto w-auto py-1 text-xs" />
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
        {media.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">{t('client.noPublished')}</p>
        ) : opened ? (
          // `key`: without it, React reuses a media's viewer from one media to the next, and the drawing
          // in progress — like the annotation shown for the selected note — survived the
          // tile change. Observed during the browser round on 2026-09-17.
          <ClientMediaViewer
            key={opened.id}
            token={token}
            media={opened}
            // `DECIDE` includes the right to comment: giving a verdict without being able to explain
            // why would make no sense.
            canComment={p.permission === 'COMMENT' || p.permission === 'DECIDE'}
            decisionStatuses={p.decisionStatuses}
            watermarkText={watermarkText}
            watermarkOpacity={p.watermark?.opacity ?? 0.08}
            onBack={() => setView(view)}
          />
        ) : (
          <ClientBrowse
            payload={p}
            view={view}
            onView={(next) => setView(next)}
            onOpen={(m) => setView(view, m.id)}
          />
        )}
      </main>

      {/* AGPL §13: guests interact remotely, so the source offer is due to them. */}
      <footer className="shrink-0 border-t border-border px-5 py-2 text-center">
        <SourceNotice />
      </footer>
    </div>
  );
}

/** Centred frame (locking / errors) with the studio styling. */
function ClientFrame({
  studio,
  children,
}: {
  studio: { name: string; logoUrl: string | null } | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto bg-background p-6 text-foreground">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card p-6">
        <div className="flex justify-center">
          {studio?.logoUrl ? (
            <img src={studio.logoUrl} alt={studio.name} className="h-10 w-auto" />
          ) : (
            <span className="text-lg font-semibold">{studio?.name ?? 'ReView'}</span>
          )}
        </div>
        {children}
      </div>
      <SourceNotice />
    </div>
  );
}

function PasswordGate({ token, onUnlocked }: { token: string; onUnlocked: () => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { shareAuth } = await clientApi.post<{ shareAuth: string }>(token, '/unlock', {
        password,
      });
      setShareAuth(token, shareAuth);
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Lock size={14} /> {t('client.passwordProtected')}
      </p>
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t('login.password')}
        aria-label={t('login.password')}
        autoFocus
        required
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {t('client.enter')}
      </Button>
    </form>
  );
}
