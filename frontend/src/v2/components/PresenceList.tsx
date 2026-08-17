// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, MessageSquare, UserRound, Users } from 'lucide-react';
import { useAuth } from '../stores/useAuth';
import { usePresence, lastSeenLabel, type PresenceUser } from '../stores/usePresence';
import { useChat } from '../stores/useChat';
import Avatar from './Avatar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { STATUS_LABEL_KEY } from '../lib/userStatus';
import { useT } from '../i18n';

/**
 * Annuaire de présence du pied de sidebar : qui est là, et de quoi le joindre —
 * chaque personne ouvre sa fiche ou une conversation privée.
 */
export default function PresenceList() {
  const t = useT();
  const self = useAuth((s) => s.user);
  const { users } = usePresence();
  const [expanded, setExpanded] = useState(true);

  if (!self) return null;
  // Les autres utilisateurs (hors soi), en ligne d'abord.
  const others = users.filter((u) => u.id !== self.id).sort((a, b) => Number(b.online) - Number(a.online));
  const onlineCount = others.filter((u) => u.online).length;

  return (
    <div className="px-3 py-2">
      <button
        onClick={() => setExpanded((o) => !o)}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary/60"
      >
        <span className="flex items-center gap-1.5">
          <Users size={14} /> {t('presence.onlineCount', { count: onlineCount })}
        </span>
        <ChevronDown
          size={14}
          className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'}
        />
      </button>
      {expanded && (
        <div className="custom-scrollbar mt-1 max-h-44 space-y-0.5 overflow-y-auto">
          {others.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t('presence.aloneHere')}</p>
          )}
          {others.map((u) => (
            <PresenceRow key={u.id} user={u} />
          ))}
        </div>
      )}
    </div>
  );
}

function PresenceRow({ user }: { user: PresenceUser }) {
  const t = useT();
  const openWith = useChat((s) => s.openWith);
  const [open, setOpen] = useState(false);

  const message = async () => {
    setOpen(false);
    try {
      await openWith(user.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title={t(STATUS_LABEL_KEY[user.status])}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-secondary/60"
        >
          <Avatar
            seed={user.id}
            initials={user.initials}
            avatarUrl={user.avatarUrl}
            size={24}
            status={user.status}
            online={user.online}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{user.displayName}</span>
            <span className="block truncate text-2xs text-muted-foreground">
              {lastSeenLabel(user.lastSeenAt, user.online)}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-48 p-1">
        <Link
          to={`/users/${user.id}`}
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <UserRound size={14} /> {t('profile.view')}
        </Link>
        <button
          onClick={() => void message()}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <MessageSquare size={14} /> {t('chat.sendMessage')}
        </button>
      </PopoverContent>
    </Popover>
  );
}
