// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, UserCog, ChevronDown, Users, Sun, Moon } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import type { UserStatus } from '../types/api';
import { usePresence, lastSeenLabel } from '../stores/usePresence';
import { useTheme } from '../stores/useTheme';
import Avatar from './Avatar';
import WhatsNew from './WhatsNew';
import { STATUS_COLOR, STATUS_LABEL } from '../lib/userStatus';
import { useT } from '../i18n';

const STATUSES: UserStatus[] = ['AVAILABLE', 'AWAY', 'DND'];

/** Pied de sidebar : profil/statut de l'utilisateur courant + présence des autres. */
export default function SidebarFooter() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const logout = useAuth((s) => s.logout);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const navigate = useNavigate();
  const { users } = usePresence();
  const [statusOpen, setStatusOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(true);

  if (!user) return null;

  const myStatus: UserStatus = user.status ?? 'AVAILABLE';
  const setStatus = async (status: UserStatus) => {
    setStatusOpen(false);
    try {
      const { user: updated } = await api.patch<{ user: typeof user }>('/api/users/me/status', { status });
      setUser(updated);
    } catch {
      /* ignore */
    }
  };

  // Les autres utilisateurs (hors soi), en ligne d'abord.
  const others = users.filter((u) => u.id !== user.id).sort((a, b) => Number(b.online) - Number(a.online));
  const onlineCount = others.filter((u) => u.online).length;

  return (
    <div className="border-t border-border">
      {/* Présence des autres utilisateurs */}
      <div className="px-3 py-2">
        <button
          onClick={() => setPresenceOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary/60"
        >
          <span className="flex items-center gap-1.5">
            <Users size={14} /> En ligne · {onlineCount}
          </span>
          <ChevronDown
            size={14}
            className={presenceOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
        </button>
        {presenceOpen && (
          <div className="custom-scrollbar mt-1 max-h-44 space-y-0.5 overflow-y-auto">
            {others.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">{t('presence.aloneHere')}</p>
            )}
            {others.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-2 rounded-md px-2 py-1"
                title={STATUS_LABEL[u.status]}
              >
                <Avatar
                  seed={u.id}
                  initials={u.initials}
                  avatarUrl={u.avatarUrl}
                  size={24}
                  status={u.status}
                  online={u.online}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{u.displayName}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {lastSeenLabel(u.lastSeenAt, u.online)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Utilisateur courant */}
      <div className="relative border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2">
          <Avatar
            seed={user.id}
            initials={user.initials ?? user.email.slice(0, 2).toUpperCase()}
            avatarUrl={user.avatarUrl}
            size={32}
            status={myStatus}
            online
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.displayName ?? user.name ?? user.email}</div>
            <button
              onClick={() => setStatusOpen((o) => !o)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: STATUS_COLOR[myStatus] }}
              />
              {STATUS_LABEL[myStatus]}
              <ChevronDown size={11} />
            </button>
          </div>
        </div>
        {statusOpen && (
          <div className="absolute bottom-16 left-3 z-20 w-44 rounded-md border border-border bg-card p-1 shadow-lg">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-secondary"
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <Link
            to="/profile"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <UserCog size={14} /> Profil
          </Link>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? t('shell.theme.toLight') : t('shell.theme.toDark')}
            className="flex items-center justify-center rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <WhatsNew collapsed />
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <LogOut size={14} /> Quitter
          </button>
        </div>
      </div>
    </div>
  );
}
