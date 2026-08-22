// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, ScrollText, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Panel } from './AdminPrimitives';
import WebhookDeliveries from './WebhookDeliveries';
import { isSilencedByFailures, scopeName } from './webhookLog';
import { useT, type MessageKey } from '../../i18n';
import type { AdminProjectRow } from '../../types/api';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

interface WebhookRow {
  id: number;
  url: string;
  events: string[];
  active: boolean;
  /** Portée : `null` = tout le studio ; sinon, ce projet et lui seul. */
  projectId: number | null;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
  failureStreak: number;
  createdAt: string;
}

const eventRows = (t: Tr) => [
  { key: 'media.published', label: t('task.published') },
  { key: 'review.decision', label: t('decision.title') },
  { key: 'comment.created', label: t('comments.created') },
];

/** Webhooks sortants (36.D) : POST JSON signés HMAC vers vos outils (Slack relais, CI…). */
export default function WebhooksPanel() {
  const t = useT();
  const qc = useQueryClient();
  const hooksQ = useQuery({
    queryKey: qk.admin('webhooks'),
    queryFn: () => api.get<{ webhooks: WebhookRow[] }>('/api/admin/webhooks').then((d) => d.webhooks),
  });
  const hooks = hooksQ.data ?? [];
  const projectsQ = useQuery({
    queryKey: qk.adminProjects,
    queryFn: () => api.get<{ projects: AdminProjectRow[] }>('/api/admin/projects'),
  });
  const projects = projectsQ.data?.projects ?? [];

  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['media.published']);
  const [scope, setScope] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openLog, setOpenLog] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.admin('webhooks') });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || events.length === 0) return;
    setBusy(true);
    try {
      const d = await api.post<{ secret: string }>('/api/admin/webhooks', {
        url: url.trim(),
        events,
        projectId: scope ? Number(scope) : null,
      });
      setSecret(d.secret);
      setUrl('');
      void invalidate();
      toast.success(t('webhooks.created'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (h: WebhookRow, body: Partial<Pick<WebhookRow, 'active' | 'projectId'>>) => {
    try {
      await api.patch(`/api/admin/webhooks/${h.id}`, body);
      void invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const remove = async (h: WebhookRow) => {
    try {
      await api.del(`/api/admin/webhooks/${h.id}`);
      toast.success(t('webhooks.deleted'));
      void invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  const test = async (h: WebhookRow) => {
    try {
      await api.post(`/api/admin/webhooks/${h.id}/test`);
      toast.success(t('webhooks.testQueued'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <Panel title={t('jobs.webhooks')}>
      <p className="mb-3 text-xs text-muted-foreground">
        {t('webhooks.postJson')} <code>X-ReView-Signature</code>
        {t('webhooks.hmacOf')} <code>timestamp.body</code>
        {t('webhooks.hintEnd')}
      </p>
      <form onSubmit={create} className="mb-3 space-y-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://exemple.com/hooks/review"
          maxLength={500}
        />
        <div className="flex flex-wrap items-center gap-3">
          {/* Portée : par défaut tout le studio, comme avant. Rattacher à un projet est ce
              qui rend un webhook donnable à un client sans lui ouvrir les autres films. */}
          <label className="flex items-center gap-1.5 text-xs">
            {t('webhooks.scope')}
            <Select
              className="py-1 text-xs"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              aria-label={t('webhooks.scope')}
            >
              <option value="">{t('webhooks.scopeAll')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          {eventRows(t).map((ev) => (
            <label key={ev.key} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                className="accent-primary"
                checked={events.includes(ev.key)}
                onChange={(e) =>
                  setEvents((cur) => (e.target.checked ? [...cur, ev.key] : cur.filter((k) => k !== ev.key)))
                }
              />
              {ev.label}
            </label>
          ))}
          <Button type="submit" size="sm" disabled={busy || !url.trim() || events.length === 0}>
            <Plus size={14} className="mr-1" /> {t('common.add')}
          </Button>
        </div>
      </form>
      {secret && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
          <span className="text-xs text-muted-foreground">{t('webhooks.hmacSecret')}</span>
          <code className="min-w-0 flex-1 truncate text-xs">{secret}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(secret);
              toast.success(t('webhooks.secretCopied'));
            }}
          >
            <Copy size={14} />
          </Button>
        </div>
      )}
      <div className="space-y-1.5">
        {hooks.map((h) => (
          <div key={h.id} className={h.active ? '' : 'opacity-50'}>
            <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
              <WebhookIcon size={15} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{h.url}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {/* La portée se corrige sans recréer le webhook : c'est ce réglage-là
                      qu'on découvre trop tard, un client ayant déjà reçu un autre film. */}
                  <Select
                    className="px-1.5 py-0.5 text-xs"
                    value={h.projectId ?? ''}
                    aria-label={t('webhooks.scope')}
                    title={scopeName(h, projects) ?? t('webhooks.scopeAll')}
                    onChange={(e) =>
                      void patch(h, { projectId: e.target.value ? Number(e.target.value) : null })
                    }
                  >
                    <option value="">{t('webhooks.scopeAll')}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  {h.events.map((ev) => (
                    <Badge key={ev} variant="secondary">
                      {ev}
                    </Badge>
                  ))}
                  {h.lastStatus != null && (
                    <Badge variant={h.lastStatus >= 200 && h.lastStatus < 300 ? 'success' : 'destructive'}>
                      {h.lastStatus}
                    </Badge>
                  )}
                  {isSilencedByFailures(h) && <Badge variant="warning">{t('webhooks.silenced')}</Badge>}
                  {h.lastError && <span className="text-destructive">{h.lastError}</span>}
                </div>
              </div>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={h.active}
                  onChange={() => void patch(h, { active: !h.active })}
                />
                {t('common.activeLower')}
              </label>
              <Button
                variant="ghost"
                size="sm"
                title={t('webhooks.deliveries')}
                onClick={() => setOpenLog((cur) => (cur === h.id ? null : h.id))}
              >
                <ScrollText size={14} />
              </Button>
              <Button variant="ghost" size="sm" title={t('webhooks.testDelivery')} onClick={() => test(h)}>
                <Send size={14} />
              </Button>
              <Button variant="ghost" size="sm" title={t('common.delete')} onClick={() => remove(h)}>
                <Trash2 size={14} className="text-destructive" />
              </Button>
            </div>
            {openLog === h.id && (
              <div className="mt-1 pl-6">
                <WebhookDeliveries webhookId={h.id} active={h.active} />
              </div>
            )}
          </div>
        ))}
        {hooks.length === 0 && <p className="text-xs text-muted-foreground">{t('webhooks.empty')}</p>}
      </div>
    </Panel>
  );
}
