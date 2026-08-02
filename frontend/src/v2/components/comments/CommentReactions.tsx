// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Smile } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import type { ReviewComment } from '../../types/api';

const EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '🔥', '✅', '❓'];

/** Chips de réactions groupées par emoji + sélecteur d'emoji (toggle par utilisateur). */
export default function CommentReactions({
  comment: c,
  currentUserId,
  reload,
  stop,
}: {
  comment: ReviewComment;
  currentUserId: number;
  reload: () => void;
  stop: (e: React.MouseEvent) => void;
}) {
  const [emojiOpen, setEmojiOpen] = useState(false);

  const react = async (emoji: string) => {
    setEmojiOpen(false);
    const mine = c.reactions?.find((r) => r.emoji === emoji && r.userId === currentUserId);
    try {
      if (mine) await api.del(`/api/comments/${c.id}/reactions/${encodeURIComponent(emoji)}`);
      else await api.post(`/api/comments/${c.id}/reactions`, { emoji });
      reload();
    } catch {
      /* ignore */
    }
  };

  const grouped = Object.values(
    (c.reactions ?? []).reduce<Record<string, { emoji: string; count: number; mine: boolean }>>((acc, r) => {
      const g = acc[r.emoji] ?? { emoji: r.emoji, count: 0, mine: false };
      g.count++;
      if (r.userId === currentUserId) g.mine = true;
      acc[r.emoji] = g;
      return acc;
    }, {}),
  );

  return (
    <>
      {grouped.map((g) => (
        <button
          key={g.emoji}
          onClick={(e) => {
            stop(e);
            react(g.emoji);
          }}
          className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs ${g.mine ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}`}
        >
          <span>{g.emoji}</span>
          <span className="text-[10px] text-muted-foreground">{g.count}</span>
        </button>
      ))}
      <div className="relative">
        <button
          onClick={(e) => {
            stop(e);
            setEmojiOpen((o) => !o);
          }}
          title="Réagir"
          className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Smile size={15} />
        </button>
        {emojiOpen && (
          <div
            onClick={stop}
            className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 rounded-md border border-border bg-card p-1 shadow-lg"
          >
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => react(e)} className="rounded p-1 text-base hover:bg-secondary">
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
