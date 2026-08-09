// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import { Button } from '../../components/ui/button';
import { timeAgo } from '../../lib/time';
import { formatTimecode } from './timelinePlayback';
import type { ReviewComment, TimelineClip } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Retours posés depuis le montage (Phase 46).
 *
 * Un commentaire appartient au plan qu'on regarde, pas au montage : il est enregistré sur
 * le média courant, au temps courant DANS ce plan. On le retrouve donc en review du shot,
 * exactement comme s'il y avait été posé — le montage n'est qu'un autre chemin pour y
 * arriver, et rien n'est perdu quand une nouvelle version remplace le plan à l'écran.
 */
export default function TimelineComments({
  clip,
  localTime,
}: {
  clip: TimelineClip | null;
  localTime: number;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const mediaId = clip?.mediaId ?? null;

  const commentsQ = useQuery({
    queryKey: qk.comments(mediaId ?? 0),
    queryFn: () =>
      api
        .get<{ items: ReviewComment[] }>(`/api/comments?mediaObjectId=${mediaId}`)
        .then((d) => d.items ?? []),
    enabled: mediaId !== null,
  });
  const comments = commentsQ.data ?? [];

  const submit = async () => {
    if (!draft.trim() || mediaId === null) return;
    setBusy(true);
    try {
      await api.post('/api/comments', {
        mediaObjectId: mediaId,
        content: draft.trim(),
        // Le retour est horodaté dans le plan : rouvrir la review y ramène directement.
        timestamp: Math.max(0, Math.round(localTime * 1000) / 1000),
      });
      setDraft('');
      await qc.invalidateQueries({ queryKey: qk.comments(mediaId) });
      toast.success(t('comments.sent'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare size={14} /> {t('comments.title')}
        </div>
        {clip && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {clip.shotCode}
            {clip.versionName ? ` · ${clip.versionName}` : ''} · {formatTimecode(localTime)}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {mediaId === null ? (
          <p className="text-xs text-muted-foreground">{t('timeline.noMediaToComment')}</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('comments.empty')}</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-md border border-border/60 bg-background p-2">
              <div className="mb-0.5 flex items-baseline gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{c.author?.name ?? '—'}</span>
                <span>{timeAgo(c.createdAt)}</span>
                {c.timestamp != null && <span className="tabular-nums">{formatTimecode(c.timestamp)}</span>}
              </div>
              <div
                className="text-xs leading-snug"
                // Le contenu est déjà assaini côté serveur (CommentService) — même rendu
                // qu'en review, dont ce panneau est une porte d'entrée.
                dangerouslySetInnerHTML={{ __html: c.content }}
              />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={mediaId === null}
          rows={3}
          placeholder={t('comments.placeholder')}
          className="w-full resize-none rounded border border-input bg-background px-2 py-1.5 text-xs disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-2">
          {clip?.mediaId != null && (
            <Link
              to={reviewPath({ id: clip.mediaId, originalName: clip.mediaName })}
              className="text-[11px] text-primary hover:underline"
            >
              {t('timeline.openInReview')}
            </Link>
          )}
          <Button size="sm" onClick={() => void submit()} disabled={busy || !draft.trim()}>
            <Send size={13} /> {t('comments.send')}
          </Button>
        </div>
      </div>
    </aside>
  );
}
