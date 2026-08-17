// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { ChevronDown, MessageSquare, Plus } from 'lucide-react';
import { useAuth } from '../../stores/useAuth';
import { useChat, conversationLabel, selectUnreadTotal } from '../../stores/useChat';
import Avatar from '../Avatar';
import PeoplePicker from './PeoplePicker';
import { useT } from '../../i18n';

/**
 * Section « Messages » du pied de sidebar : les fils en cours, le plus récent en tête,
 * avec leur compteur de non-lus. Cliquer ouvre la fenêtre de conversation.
 */
export default function ConversationList() {
  const t = useT();
  const self = useAuth((s) => s.user);
  const conversations = useChat((s) => s.conversations);
  const unreadTotal = useChat(selectUnreadTotal);
  const openId = useChat((s) => s.openId);
  const open = useChat((s) => s.open);
  const start = useChat((s) => s.start);
  const createGroup = useChat((s) => s.createGroup);
  const [expanded, setExpanded] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    start();
  }, [start]);

  if (!self) return null;

  return (
    <div className="px-3 py-2">
      <div className="flex items-center">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary/60"
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare size={14} /> {t('chat.title')}
            {unreadTotal > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent2 px-1 text-2xs font-semibold text-accent2-foreground">
                {unreadTotal > 9 ? '9+' : unreadTotal}
              </span>
            )}
          </span>
          <ChevronDown
            size={14}
            className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
        </button>
        <button
          onClick={() => setCreating(true)}
          title={t('chat.group.create')}
          aria-label={t('chat.group.create')}
          className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Plus size={14} />
        </button>
      </div>

      {expanded && (
        <div className="custom-scrollbar mt-1 max-h-40 space-y-0.5 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t('chat.empty')}</p>
          )}
          {conversations.map((c) => {
            const others = c.members.filter((m) => m.id !== self.id);
            const face = others[0];
            return (
              <button
                key={c.id}
                onClick={() => open(c.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                  openId === c.id ? 'bg-secondary' : 'hover:bg-secondary/60'
                }`}
              >
                <Avatar
                  seed={face?.id ?? c.id}
                  initials={c.isGroup ? String(c.members.length) : (face?.initials ?? '—')}
                  avatarUrl={c.isGroup ? null : face?.avatarUrl}
                  size={24}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {conversationLabel(c, self.id, t('chat.you'))}
                  </span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {c.lastMessage?.body ?? t('chat.noMessages')}
                  </span>
                </span>
                {c.unread > 0 && (
                  <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent2 px-1 text-2xs font-semibold text-accent2-foreground">
                    {c.unread > 9 ? '9+' : c.unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {creating && (
        <PeoplePicker
          open
          onOpenChange={setCreating}
          title={t('chat.group.create')}
          withGroupName
          onSubmit={(ids, name) => createGroup(ids, name)}
        />
      )}
    </div>
  );
}
