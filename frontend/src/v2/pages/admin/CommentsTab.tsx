// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, RotateCcw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import Avatar from '../../components/Avatar';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { fmtDateTime } from './adminShared';
import type { AdminCommentRow, AdminProjectRow, Paginated, User } from '../../types/api';
import { useT } from '../../i18n';

const PAGE_SIZE = 50;

/** Commentaires de tout le studio : recherche, filtres, modération (résolution/suppression). */
export default function CommentsTab() {
  const t = useT();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [authorId, setAuthorId] = useState('');
  const [resolved, setResolved] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<AdminCommentRow | null>(null);

  const projectsQ = useQuery({
    queryKey: qk.adminProjects,
    queryFn: () => api.get<{ projects: AdminProjectRow[] }>('/api/admin/projects'),
  });
  const usersQ = useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<{ users: User[] }>('/api/users').then((d) => d.users),
  });
  const filter = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (projectId) filter.set('projectId', projectId);
  if (authorId) filter.set('authorId', authorId);
  if (resolved) filter.set('resolved', resolved);
  if (q.trim()) filter.set('q', q.trim());
  const listQ = useQuery({
    queryKey: qk.adminComments(filter.toString()),
    queryFn: () => api.get<Paginated<AdminCommentRow>>(`/api/admin/comments?${filter}`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'comments'] });
  const toggleResolved = async (c: AdminCommentRow) => {
    try {
      await api.patch(`/api/comments/${c.id}`, { isResolved: !c.isResolved });
      toast.success(c.isResolved ? t('comments.reopened') : t('comment.resolved'));
      void invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('comment.updateFailed'));
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/comments/${deleting.id}`);
      toast.success(t('comments.deleted'));
      setDeleting(null);
      void invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.delete'));
    }
  };

  if (!listQ.data) return <SkeletonRows count={6} />;
  const { items, total } = listQ.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder={t('comments.search.placeholder')}
            className="pl-8"
          />
        </div>
        <Select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('reviews.filter.allProjects')}</option>
          {(projectsQ.data?.projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          value={authorId}
          onChange={(e) => {
            setAuthorId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('comments.filter.allAuthors')}</option>
          {(usersQ.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName ?? u.name ?? u.email}
            </option>
          ))}
        </Select>
        <Select
          value={resolved}
          onChange={(e) => {
            setResolved(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('comments.filter.resolution')}</option>
          <option value="false">{t('comments.filter.open')}</option>
          <option value="true">{t('comments.filter.resolved')}</option>
        </Select>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{t('comments.total', { count: total })}</p>
      <div className="space-y-1.5">
        {items.map((c) => (
          <div key={c.id} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              {c.author ? (
                <Avatar
                  seed={c.author.id}
                  initials={c.author.initials ?? '?'}
                  avatarUrl={c.author.avatarUrl}
                  size={22}
                />
              ) : (
                <Badge variant="secondary">{t('comments.guest')}</Badge>
              )}
              <span className="font-medium">
                {c.author?.displayName ?? c.guestName ?? t('comments.anonymous')}
              </span>
              {c.parentId != null && <Badge variant="secondary">{t('comments.reply')}</Badge>}
              {c.isResolved && (
                <Badge variant="secondary">
                  <CheckCircle2 size={12} /> {t('comments.resolvedLower')}
                </Badge>
              )}
              <span className="min-w-0 flex-1" />
              <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
              <button
                onClick={() => toggleResolved(c)}
                title={c.isResolved ? t('comment.reopen') : t('comment.markResolvedShort')}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {c.isResolved ? <RotateCcw size={14} /> : <CheckCircle2 size={14} />}
              </button>
              <button
                onClick={() => setDeleting(c)}
                title={t('comments.moderate')}
                className="rounded p-1.5 text-destructive hover:bg-secondary"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-foreground/90">{c.content}</p>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Link
                to={`/review/${c.media.id}`}
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <ExternalLink size={11} /> {c.media.originalName}
              </Link>
              <span>· {c.media.kind}</span>
              {c.timestamp != null && <span>· {t('comments.atTime', { time: c.timestamp.toFixed(2) })}</span>}
              {c.replyCount > 0 && <span>· {t('comments.replyCount', { count: c.replyCount })}</span>}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('comments.noMatch')}
          </p>
        )}
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('common.previous')}
          </Button>
          <span>{t('common.pagination', { page, pages })}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('common.next')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t('comments.delete.title')}
        message={
          deleting?.replyCount
            ? t('comments.delete.messageWithReplies', { count: deleting.replyCount })
            : t('comments.delete.message')
        }
        confirmLabel={t('common.delete')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
