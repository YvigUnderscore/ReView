// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, UserCog, ChevronDown, Sun, Moon } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import type { UserStatus } from '../types/api';
import { useTheme } from '../stores/useTheme';
import Avatar from './Avatar';
import SocialPanel from './shell/SocialPanel';
import WhatsNew from './WhatsNew';
import { STATUS_COLOR, STATUS_LABEL_KEY } from '../lib/userStatus';
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
  const [statusOpen, setStatusOpen] = useState(false);

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

  return (
    <div className="border-t border-border">
      {/* Un seul point d'entrée pour la partie sociale (C1) : présence et messagerie
          montraient les mêmes personnes dans deux sections empilées. */}
      <div className="px-3 pt-2">
        <SocialPanel />
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
              {t(STATUS_LABEL_KEY[myStatus])}
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
                {t(STATUS_LABEL_KEY[s])}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <Link
            to="/profile"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <UserCog size={14} /> {t('shell.profile')}
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
              void navigate('/login');
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <LogOut size={14} /> {t('shell.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
