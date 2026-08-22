// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type RefObject } from 'react';
import { Clock, Send } from 'lucide-react';
import type { ClientComment } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { formatTime } from '../review/reviewTypes';
import { useT } from '../../i18n';

/**
 * Fil de commentaires de la page client : notes rendues visibles au client par le studio,
 * horodatées quand elles portent sur une vidéo (clic = seek), et composeur pour les liens en
 * permission COMMENT. L'invité n'a pas de compte : son nom est saisi une fois et mémorisé
 * localement, rien de plus n'est demandé.
 */
export default function ClientComments({
  comments,
  canComment,
  timed,
  onSeek,
  onSubmit,
  composerRef,
}: {
  comments: ClientComment[];
  canComment: boolean;
  /** Le média porte une notion de temps (vidéo) — affiche et rend cliquable l'horodatage. */
  timed: boolean;
  /** Position dans le **média** (hors slate) demandée par le clic sur un horodatage. */
  onSeek: (mediaSeconds: number) => void;
  onSubmit: (guestName: string, content: string) => Promise<void>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useT();
  const [guestName, setGuestName] = useState(() => localStorage.getItem('client-guest-name') ?? '');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim() || !content.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(guestName.trim(), content.trim());
      setContent('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex w-full flex-col rounded-lg border border-border bg-card lg:w-80">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{t('admin.tab.comments')}</h2>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {comments.length === 0 && <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>}
        {comments.map((c) => (
          <div key={c.id} className="rounded-md bg-secondary/40 p-2.5 text-sm">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {c.author?.name ?? c.guestName ?? t('comments.anonymous')}
              </span>
              {c.timestamp != null && timed && (
                <button
                  onClick={() => onSeek(c.timestamp!)}
                  className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-primary hover:bg-primary/25"
                >
                  <Clock size={11} /> {formatTime(c.timestamp)}
                </button>
              )}
            </div>
            {/* Contenu déjà assaini côté serveur (sanitizeHtml) — affiché en texte brut. */}
            <p className="whitespace-pre-wrap break-words">{c.content.replace(/<[^>]+>/g, '')}</p>
          </div>
        ))}
      </div>
      {canComment && (
        <form onSubmit={submit} className="space-y-2 border-t border-border p-3">
          <Input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder={t('setup.adminName')}
            maxLength={80}
            required
          />
          <Textarea
            ref={composerRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={timed ? t('client.commentAtFrame') : t('client.yourComment')}
            rows={3}
            maxLength={10000}
            required
          />
          <Button type="submit" size="sm" disabled={busy} className="w-full">
            <Send size={13} className="mr-1" /> {t('common.send')}
          </Button>
        </form>
      )}
    </aside>
  );
}
