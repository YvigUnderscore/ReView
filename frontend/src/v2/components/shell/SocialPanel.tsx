// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { LogOut, MessageSquare, Plus, Search, UserRound, Users } from 'lucide-react';
import { useAuth } from '../../stores/useAuth';
import { usePresence, lastSeenLabel } from '../../stores/usePresence';
import { useChat, conversationLabel, selectUnreadTotal } from '../../stores/useChat';
import Avatar from '../Avatar';
import PeoplePicker from '../chat/PeoplePicker';
import EntityContextMenu from '../ui/entity-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { STATUS_LABEL_KEY } from '../../lib/userStatus';
import { chatSystemText } from '../../lib/chatSystemText';
import { useT } from '../../i18n';

/**
 * Bloc social unifié (C1).
 *
 * La présence et la messagerie occupaient deux sections empilées, chacune avec son
 * chevron, sa hauteur limitée et sa source de données — alors qu'elles montrent les mêmes
 * personnes : « qui est là » servait déjà à démarrer une conversation. Elles sont
 * réunies derrière un seul bouton, avec la recherche qui manquait : au-delà d'une
 * quinzaine de personnes, la liste ne se parcourait plus.
 *
 * Les conversations viennent en premier — c'est ce qu'on rouvre — puis les personnes,
 * en ligne d'abord.
 */
export default function SocialPanel() {
  const t = useT();
  const self = useAuth((s) => s.user);
  const { users } = usePresence();
  const conversations = useChat((s) => s.conversations);
  const unreadTotal = useChat(selectUnreadTotal);
  const openId = useChat((s) => s.openId);
  const open = useChat((s) => s.open);
  const start = useChat((s) => s.start);
  const createGroup = useChat((s) => s.createGroup);
  const openWith = useChat((s) => s.openWith);
  const leave = useChat((s) => s.leave);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    start();
  }, [start]);

  const others = useMemo(
    () =>
      users
        .filter((u) => u.id !== self?.id)
        .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName)),
    [users, self?.id],
  );
  const onlineCount = others.filter((u) => u.online).length;

  const needle = query.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const shownPeople = others.filter((u) => matches(u.displayName));
  const shownThreads = self
    ? conversations.filter((c) => matches(conversationLabel(c, self.id, t('chat.you'))))
    : [];

  if (!self) return null;

  const message = async (userId: number) => {
    setPanelOpen(false);
    try {
      await openWith(userId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  return (
    <>
      <Popover open={panelOpen} onOpenChange={setPanelOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            title={t('social.title')}
          >
            <Users size={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              {t('presence.onlineCount', { count: onlineCount })}
            </span>
            {unreadTotal > 0 && (
              <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent2 px-1 text-2xs font-semibold text-accent2-foreground">
                {unreadTotal > 9 ? '9+' : unreadTotal}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="right" className="w-72 p-2">
          <div className="mb-2 flex items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5">
              <Search size={14} className="shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('social.search')}
                className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground"
              />
            </div>
            <button
              onClick={() => {
                setPanelOpen(false);
                setCreating(true);
              }}
              title={t('chat.group.create')}
              aria-label={t('chat.group.create')}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="custom-scrollbar max-h-96 space-y-0.5 overflow-y-auto">
            {shownThreads.length > 0 && (
              <p className="px-2 pt-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('chat.title')}
              </p>
            )}
            {shownThreads.map((c) => {
              const face = c.members.find((m) => m.id !== self.id);
              const label = conversationLabel(c, self.id, t('chat.you'));
              return (
                <EntityContextMenu
                  key={c.id}
                  entries={[
                    {
                      id: `leave-${c.id}`,
                      label: t('chat.leave'),
                      icon: <LogOut size={14} />,
                      danger: true,
                      onSelect: () => void leave(c.id, self.id),
                    },
                  ]}
                >
                  <button
                    onClick={() => {
                      setPanelOpen(false);
                      open(c.id);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
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
                      <span className="block truncate text-xs font-medium">{label}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {c.lastMessage ? chatSystemText(t, c.lastMessage) : t('chat.noMessages')}
                      </span>
                    </span>
                    {c.unread > 0 && (
                      <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent2 px-1 text-2xs font-semibold text-accent2-foreground">
                        {c.unread > 9 ? '9+' : c.unread}
                      </span>
                    )}
                  </button>
                </EntityContextMenu>
              );
            })}

            {shownPeople.length > 0 && (
              <p className="px-2 pt-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('social.people')}
              </p>
            )}
            {shownPeople.map((u) => (
              <EntityContextMenu
                key={u.id}
                entries={[
                  {
                    id: `msg-${u.id}`,
                    label: t('chat.sendMessage'),
                    icon: <MessageSquare size={14} />,
                    onSelect: () => void message(u.id),
                  },
                ]}
              >
                <div className="flex w-full items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-secondary/60">
                  <Avatar
                    seed={u.id}
                    initials={u.initials}
                    avatarUrl={u.avatarUrl}
                    size={24}
                    status={u.status}
                    online={u.online}
                  />
                  <button
                    onClick={() => void message(u.id)}
                    title={t(STATUS_LABEL_KEY[u.status])}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-xs font-medium">{u.displayName}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {lastSeenLabel(u.lastSeenAt, u.online)}
                    </span>
                  </button>
                  <Link
                    to={`/users/${u.id}`}
                    onClick={() => setPanelOpen(false)}
                    title={t('profile.view')}
                    aria-label={t('profile.view')}
                    className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <UserRound size={14} />
                  </Link>
                </div>
              </EntityContextMenu>
            ))}

            {shownThreads.length === 0 && shownPeople.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {needle ? t('social.noMatch') : t('presence.aloneHere')}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {creating && (
        <PeoplePicker
          open
          onOpenChange={setCreating}
          title={t('chat.group.create')}
          withGroupName
          onSubmit={(ids, name) => createGroup(ids, name)}
        />
      )}
    </>
  );
}
