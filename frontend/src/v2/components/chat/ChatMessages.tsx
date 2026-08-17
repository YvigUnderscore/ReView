// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import Avatar from '../Avatar';
import { useChat } from '../../stores/useChat';
import { api } from '../../../lib/apiClient';
import { timeAgo } from '../../lib/time';
import type { ChatMessage } from '../../types/chat';
import { useT } from '../../i18n';

/**
 * Fil de messages : du plus ancien en haut au plus récent en bas, collé au bas à
 * l'arrivée d'un message — sauf si l'on est remonté dans l'historique, auquel cas
 * un saut au dernier message ferait perdre la ligne qu'on était en train de lire.
 */
export default function ChatMessages({ conversationId, selfId }: { conversationId: number; selfId: number }) {
  const t = useT();
  const messages = useChat((s) => s.messages[conversationId]);
  const atStart = useChat((s) => s.atStart[conversationId]);
  const loadOlder = useChat((s) => s.loadOlder);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastId = messages?.at(-1)?.id ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom || el.scrollTop === 0) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  if (!messages) {
    return <div className="flex-1 p-4 text-xs text-muted-foreground">{t('common.loading')}</div>;
  }
  if (messages.length === 0) {
    return <div className="flex-1 p-4 text-xs text-muted-foreground">{t('chat.noMessages')}</div>;
  }

  return (
    <div ref={scrollRef} className="custom-scrollbar flex-1 space-y-2 overflow-y-auto px-3 py-2">
      {!atStart && (
        <button
          onClick={() => void loadOlder(conversationId)}
          className="w-full rounded px-2 py-1 text-center text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          {t('chat.loadOlder')}
        </button>
      )}
      {messages.map((m) => (
        <Row key={m.id} message={m} selfId={selfId} />
      ))}
    </div>
  );
}

function Row({ message, selfId }: { message: ChatMessage; selfId: number }) {
  const t = useT();
  if (message.isSystem) {
    return <p className="py-1 text-center text-xs italic text-muted-foreground">{message.body}</p>;
  }
  const author = message.author;
  const mine = author?.id === selfId;
  return (
    <div className="group flex items-start gap-2">
      {author ? (
        <Link to={`/users/${author.id}`} title={author.displayName}>
          <Avatar seed={author.id} initials={author.initials} avatarUrl={author.avatarUrl} size={24} />
        </Link>
      ) : (
        <Avatar seed={0} initials="—" size={24} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-medium">
            {mine ? t('chat.you') : (author?.displayName ?? t('chat.deletedAuthor'))}
          </span>
          <span className="shrink-0 text-2xs text-muted-foreground">{timeAgo(message.createdAt)}</span>
          {mine && (
            <button
              onClick={() => void api.del(`/api/chat/messages/${message.id}`).catch(() => undefined)}
              title={t('chat.delete')}
              className="ml-auto shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {/* Corps rendu en texte : `whitespace-pre-wrap` garde les retours à la ligne sans
            ouvrir la porte au HTML — un message est écrit par un utilisateur. */}
        <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{message.body}</p>
      </div>
    </div>
  );
}
