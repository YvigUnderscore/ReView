// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { KeyRound, MonitorSmartphone, X } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Panel } from './AdminPrimitives';
import { auditActionLabel, auditEntityLink, fmtDateTime } from './adminShared';
import { useT } from '../../i18n';
import type {
  AdminApiToken,
  AdminUserActivity,
  AdminUserMembership,
  AdminUserSession,
} from '../../types/api';

/** Panneaux de la fiche utilisateur admin (projets, sessions, tokens, activité). */

export function MembershipsPanel({ memberships }: { memberships: AdminUserMembership[] }) {
  const t = useT();
  return (
    <Panel title={`Projets (${memberships.length})`}>
      <div className="space-y-1.5">
        {memberships.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
            <Link
              to={`/admin/projects/${m.project.id}`}
              className="min-w-0 truncate font-medium hover:underline"
            >
              {m.project.name}
              {m.project.deletedAt && <span className="ml-1 text-xs text-destructive">(corbeille)</span>}
            </Link>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{m.role ?? t('user.globalRole')}</Badge>
              depuis le {fmtDateTime(m.joinedAt)}
            </span>
          </div>
        ))}
        {memberships.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('userDetail.noProject')}</p>
        )}
      </div>
    </Panel>
  );
}

export function SessionsPanel({
  sessions,
  onRevoke,
  onRevokeAll,
}: {
  sessions: AdminUserSession[];
  onRevoke: (sid: string) => void;
  onRevokeAll: () => void;
}) {
  const t = useT();
  return (
    <Panel title={`Sessions actives (${sessions.length})`}>
      <div className="space-y-1.5">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-sm">
            <MonitorSmartphone size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={s.userAgent ?? undefined}>
              {s.userAgent ?? 'Client inconnu'}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {s.ip ?? '—'} · vue le {fmtDateTime(s.lastSeenAt)}
            </span>
            <button
              onClick={() => onRevoke(s.id)}
              title={t('userDetail.revokeSession')}
              className="rounded p-1 text-destructive hover:bg-secondary"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('userDetail.noSession')}</p>
        )}
      </div>
      {sessions.length > 0 && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRevokeAll}>
          {t('sessions.revokeAll')}
        </Button>
      )}
    </Panel>
  );
}

export function TokensPanel({ tokens }: { tokens: AdminApiToken[] }) {
  const t = useT();
  return (
    <Panel title={`Tokens d'API (${tokens.length})`}>
      <div className="space-y-1.5">
        {tokens.map((tok) => (
          <div key={tok.id} className="flex items-center gap-2 text-sm">
            <KeyRound size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{tok.name}</span>
            <Badge variant="secondary">{tok.scopes.join(', ')}</Badge>
            <span className="shrink-0 text-xs text-muted-foreground">
              {tok.lastUsedAt ? `utilisé le ${fmtDateTime(tok.lastUsedAt)}` : t('common.neverUsed')}
              {tok.expiresAt ? ` · expire le ${fmtDateTime(tok.expiresAt)}` : ''}
            </span>
          </div>
        ))}
        {tokens.length === 0 && <p className="text-xs text-muted-foreground">{t('tokens.empty')}</p>}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{t('sessions.adminRevoke')}</p>
    </Panel>
  );
}

export function ActivityPanel({ activity }: { activity: AdminUserActivity[] }) {
  const t = useT();
  return (
    <Panel title={t('userDetail.recentAudit')}>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {activity.map((a) => {
          const link = auditEntityLink(a.entityType, a.entityId);
          return (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {link ? (
                  <Link to={link} className="text-foreground hover:underline">
                    {auditActionLabel(a.action, t)}
                  </Link>
                ) : (
                  <span className="text-foreground">{auditActionLabel(a.action, t)}</span>
                )}
                {a.entityType ? ` · ${a.entityType} ${a.entityId ?? ''}` : ''}
              </span>
              <span className="shrink-0">{fmtDateTime(a.createdAt)}</span>
            </li>
          );
        })}
        {activity.length === 0 && <li>{t('userDetail.noAudit')}</li>}
      </ul>
    </Panel>
  );
}
