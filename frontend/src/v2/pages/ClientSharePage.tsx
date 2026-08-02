// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Image as ImageIcon, Box, Lock, Sparkles } from 'lucide-react';
import { clientApi, setShareAuth, ClientApiError } from './client/clientApi';
import ClientMediaViewer from './client/ClientMediaViewer';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import SourceNotice from '../components/SourceNotice';
import type { ClientMedia, ClientSharePayload, MediaKind } from '../types/api';
import { useT } from '../i18n';
import { intlLocale } from '../i18n';

const kindIcon: Record<MediaKind, React.ReactNode> = {
  VIDEO: <Film size={26} />,
  IMAGE: <ImageIcon size={26} />,
  MODEL_3D: <Box size={26} />,
  SPLAT: <Sparkles size={26} />,
};

/**
 * Page client publique (35.D) : accès par lien de partage, habillage studio, lecture +
 * commentaire uniquement — zéro navigation vers l'app.
 */
export default function ClientSharePage() {
  const t = useT();
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ClientMedia | null>(null);

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

  if (payloadQ.error) {
    const err = payloadQ.error;
    return (
      <ClientFrame studio={null}>
        <p className="text-center text-sm text-muted-foreground">
          {err instanceof ClientApiError && err.status === 410
            ? 'La limite de vues de ce lien est atteinte. Demandez un nouveau lien au studio.'
            : 'Ce lien de partage est invalide, expiré ou révoqué.'}
        </p>
      </ClientFrame>
    );
  }
  if (!p) {
    return (
      <ClientFrame studio={null}>
        <p className="text-center text-sm text-muted-foreground">Chargement…</p>
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
  const watermarkText = p.watermark?.enabled
    ? `${p.label ?? 'Partage client'} — ${p.studio.name} — ${new Date().toLocaleDateString(intlLocale())}`
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        {p.studio.logoUrl ? (
          <img src={p.studio.logoUrl} alt={p.studio.name} className="h-8 w-auto" />
        ) : (
          <span className="text-base font-semibold">{p.studio.name}</span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{p.project?.name}</p>
          <p className="text-xs text-muted-foreground">Review client</p>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-5">
        {selected ? (
          <ClientMediaViewer
            token={token}
            media={selected}
            canComment={p.permission === 'COMMENT'}
            watermarkText={watermarkText}
            watermarkOpacity={p.watermark?.opacity ?? 0.08}
            onBack={() => setSelected(null)}
          />
        ) : (
          <>
            {media.length === 0 && (
              <p className="m-auto text-sm text-muted-foreground">{t('client.noPublished')}</p>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {media.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelected(m)}
                  className="group overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/60"
                >
                  <div className="flex aspect-video items-center justify-center overflow-hidden bg-black/50 text-muted-foreground">
                    {m.thumbnailUrl ? (
                      <img
                        src={m.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      kindIcon[m.kind]
                    )}
                  </div>
                  <p className="truncate px-2.5 py-2 text-xs">{m.originalName}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </main>

      {/* AGPL §13 : les invités interagissent à distance, l'offre de source leur est due. */}
      <footer className="border-t border-border px-5 py-2 text-center">
        <SourceNotice />
      </footer>
    </div>
  );
}

/** Cadre centré (verrouillage / erreurs) avec l'habillage studio. */
function ClientFrame({
  studio,
  children,
}: {
  studio: { name: string; logoUrl: string | null } | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card p-6">
        <div className="flex justify-center">
          {studio?.logoUrl ? (
            <img src={studio.logoUrl} alt={studio.name} className="h-10 w-auto" />
          ) : (
            <span className="text-lg font-semibold">{studio?.name ?? 'Review'}</span>
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
      setError(err instanceof Error ? err.message : 'Erreur');
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
