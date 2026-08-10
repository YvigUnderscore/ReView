// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, MessageSquare, Phone, UserCog } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useChat } from '../stores/useChat';
import Shell from '../components/Shell';
import Avatar from '../components/Avatar';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { lastSeenLabel } from '../stores/usePresence';
import { ROLE_LABEL_KEY, STATUS_LABEL_KEY } from '../lib/userStatus';
import type { UserProfile } from '../types/api';
import { useT } from '../i18n';

/** Fiche publique d'un membre du studio : qui il est, ce qu'il fait, comment le joindre. */
export default function UserProfilePage() {
  const t = useT();
  const { id } = useParams();
  const userId = Number(id);
  const openWith = useChat((s) => s.openWith);

  const { data, isLoading, isError } = useQuery({
    queryKey: qk.userProfile(userId),
    queryFn: () => api.get<{ user: UserProfile }>(`/api/users/${userId}/profile`).then((r) => r.user),
    enabled: Number.isInteger(userId),
  });

  if (isLoading) {
    return (
      <Shell title={t('profile.view')}>
        <div className="mx-auto max-w-2xl space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Shell>
    );
  }
  if (isError || !data) {
    return (
      <Shell title={t('profile.view')}>
        <p className="mx-auto max-w-2xl text-sm text-muted-foreground">{t('profile.notFound')}</p>
      </Shell>
    );
  }

  const message = async () => {
    try {
      await openWith(data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  return (
    <Shell title={data.displayName}>
      <div className="mx-auto max-w-2xl space-y-4">
        <section className="flex items-start gap-4 rounded-lg border border-border bg-card p-5">
          <Avatar
            seed={data.id}
            initials={data.initials}
            avatarUrl={data.avatarUrl}
            size={72}
            status={data.status}
            online={data.online}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{data.displayName}</h1>
            {data.jobTitle && <p className="text-sm text-muted-foreground">{data.jobTitle}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {t(ROLE_LABEL_KEY[data.role])} · {t(STATUS_LABEL_KEY[data.status])} ·{' '}
              {lastSeenLabel(data.lastSeenAt, data.online)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {data.isSelf ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/profile">
                  <UserCog size={14} /> {t('profile.edit')}
                </Link>
              </Button>
            ) : (
              <Button size="sm" onClick={() => void message()}>
                <MessageSquare size={14} /> {t('chat.sendMessage')}
              </Button>
            )}
          </div>
        </section>

        {data.bio && (
          <section className="space-y-2 rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">{t('profile.bio')}</h2>
            <p className="whitespace-pre-wrap text-sm text-foreground/90">{data.bio}</p>
          </section>
        )}

        {(data.email || data.phone) && (
          <section className="space-y-2 rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">{t('profile.contact')}</h2>
            {data.email && (
              <p className="flex items-center gap-2 text-sm">
                <Mail size={14} className="shrink-0 text-muted-foreground" />
                <a href={`mailto:${data.email}`} className="text-primary hover:underline">
                  {data.email}
                </a>
              </p>
            )}
            {data.phone && (
              <p className="flex items-center gap-2 text-sm">
                <Phone size={14} className="shrink-0 text-muted-foreground" />
                <a href={`tel:${data.phone}`} className="text-primary hover:underline">
                  {data.phone}
                </a>
              </p>
            )}
          </section>
        )}

        {!data.isSelf && (
          <section className="space-y-2 rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">{t('profile.sharedProjects')}</h2>
            {data.sharedProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('profile.sharedProjects.empty')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.sharedProjects.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/projects/${p.id}`}
                      className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}
