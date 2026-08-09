// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Send, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import { timeAgo } from '../../lib/time';
import { Button } from '../../components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { formatTimecode } from './timelinePlayback';
import { shotLabelOf, type MontageComment } from './montageFeedback';
import type { TimelineClip } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Les retours du montage (Phase 46).
 *
 * Ils appartiennent au montage : on relit le film et on annote le film, sans que chaque
 * note tombe d'office dans la review de l'artiste. Chaque retour reste malgré tout ancré
 * au média du plan et à sa frame — le clic droit « renvoyer sur la review du plan » ne
 * fait donc que lever le rideau, et le retour atterrit exactement sur la bonne image.
 */
export default function MontageComments({
  timelineId,
  clips,
  clip,
  localTime,
  montageTime,
  items,
  selectedId,
  onSelect,
  annotation,
  annotating,
  onToggleAnnotate,
  onPosted,
}: {
  timelineId: number;
  /** Les plans du montage : ils donnent son shot à chaque retour. */
  clips: TimelineClip[];
  clip: TimelineClip | null;
  localTime: number;
  montageTime: number;
  items: MontageComment[];
  selectedId: number | null;
  onSelect: (c: MontageComment) => void;
  /** Formes en cours de dessin, jointes au prochain retour. */
  annotation: unknown;
  annotating: boolean;
  onToggleAnnotate: () => void;
  onPosted: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const mediaId = clip?.mediaId ?? null;

  const refresh = () => qc.invalidateQueries({ queryKey: qk.timelineComments(timelineId) });

  const submit = async () => {
    if (!draft.trim() || mediaId === null) return;
    setBusy(true);
    try {
      await api.post('/api/comments', {
        mediaObjectId: mediaId,
        content: draft.trim(),
        // Deux échelles, gardées ensemble : la frame DANS le plan (ce qui permettra de
        // renvoyer le retour au bon endroit) et la position dans le film entier.
        timestamp: Math.max(0, Math.round(localTime * 1000) / 1000),
        timelineId,
        timelineTime: Math.max(0, Math.round(montageTime * 1000) / 1000),
        annotation: annotation ?? undefined,
      });
      setDraft('');
      onPosted();
      await refresh();
      toast.success(t('comments.sent'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const share = async (c: MontageComment) => {
    try {
      await api.post(`/api/comments/${c.id}/share`, {});
      if (c.mediaObjectId) await qc.invalidateQueries({ queryKey: qk.comments(c.mediaObjectId) });
      await refresh();
      toast.success(t('timeline.shareDone', { shot: shotLabelOf(clips, c.mediaObjectId) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <MessageSquare size={14} /> {t('comments.title')}
        <span className="ml-auto text-xs font-normal text-muted-foreground">{items.length}</span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {items.length === 0 && <p className="text-xs text-muted-foreground">{t('comments.empty')}</p>}
        {items.map((c) => (
          <ContextMenu key={c.id}>
            <ContextMenuTrigger asChild>
              <div
                onClick={() => onSelect(c)}
                className={`cursor-pointer rounded-md border p-2 ${
                  c.id === selectedId ? 'border-primary bg-primary/5' : 'border-border/60 bg-background'
                }`}
              >
                <div className="mb-0.5 flex items-baseline gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{c.author?.name ?? '—'}</span>
                  <span className="tabular-nums text-primary">{formatTimecode(c.timelineTime ?? 0)}</span>
                  <span className="ml-auto">{timeAgo(c.createdAt)}</span>
                </div>
                <div
                  className="text-xs leading-snug"
                  // Contenu déjà assaini côté serveur (CommentService), comme en review.
                  dangerouslySetInnerHTML={{ __html: c.content }}
                />
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{shotLabelOf(clips, c.mediaObjectId)}</span>
                  {c.sharedToShot && (
                    <span className="rounded bg-primary/15 px-1 py-0.5 text-primary">
                      {t('timeline.sharedToShot')}
                    </span>
                  )}
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => void share(c)} disabled={c.sharedToShot}>
                <Share2 size={13} /> {t('timeline.shareToShot')}
              </ContextMenuItem>
              {c.mediaObjectId !== null && (
                <ContextMenuItem asChild>
                  <Link to={`${reviewPath({ id: c.mediaObjectId })}?comment=${c.id}`}>
                    {t('timeline.openInReview')}
                  </Link>
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ))}
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
        {mediaId === null && <p className="text-[11px] text-amber-500">{t('timeline.noMediaToComment')}</p>}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onToggleAnnotate}
            title={t('comments.annotate')}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
              annotating ? 'border-primary text-primary' : 'border-border text-muted-foreground'
            }`}
          >
            <Pencil size={12} /> {t('comments.annotate')}
          </button>
          <Button size="sm" onClick={() => void submit()} disabled={busy || !draft.trim()}>
            <Send size={13} /> {t('comments.send')}
          </Button>
        </div>
      </div>
    </aside>
  );
}
