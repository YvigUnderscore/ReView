// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { qk } from '../lib/query';
import { useInfiniteList } from '../lib/useInfiniteList';
import { reviewPath } from '../lib/slug';
import { timeAgo } from '../lib/time';
import PageShell from '../components/PageShell';
import ListSentinel, { ListCount } from '../components/ListSentinel';
import EmptyState from '../components/ui/empty-state';
import { SkeletonCards } from '../components/ui/skeleton';
import type { CommentFeedItem } from './mywork/myWorkTypes';
import { useT } from '../i18n';

/**
 * The feed of the latest comments within my scope.
 *
 * The fourth card on the Home page counts comments; it borrowed its label from the
 * review feed's filter ("All") and led to `/reviews`, which shows none of them. A
 * counter must lead to its own rows, otherwise nobody can check it.
 *
 * One row = one note (not a media item, as in "latest reviews"): that is the figure
 * one expands. A CLIENT sees only the notes addressed to them — the server bounds,
 * the page sorts nothing.
 */

/** A note in the feed: the text first, then where it was left and by whom. */
function CommentRow({ note }: { note: CommentFeedItem }) {
  const t = useT();
  const place = [note.mediaName, note.location, note.versionName].filter(Boolean).join(' · ');
  return (
    <Link
      to={reviewPath({ id: note.mediaId, originalName: note.mediaName })}
      className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-secondary/60"
    >
      <MessageSquare size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-sm">{note.content}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {[note.author ?? t('comments.anonymous'), place, timeAgo(note.createdAt)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </Link>
  );
}

export default function CommentsPage() {
  const t = useT();
  const list = useInfiniteList<CommentFeedItem>(qk.commentFeed(''), '/api/dashboard/comments', {
    keepPrevious: true,
  });
  const { data: items, error } = list;

  return (
    <PageShell title={t('mywork.comments.title')}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('mywork.comments.title')}</h1>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}

      {items === undefined ? (
        <SkeletonCards />
      ) : items.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={t('comments.empty')}
          description={t('mywork.comments.empty.description')}
        />
      ) : (
        <>
          <ListCount
            loaded={list.loaded}
            total={list.total}
            label={t('comments.total', { count: list.total })}
          />
          <div className="space-y-0.5 rounded-lg border border-border bg-card p-2">
            {items.map((note) => (
              <CommentRow key={note.id} note={note} />
            ))}
          </div>
          <ListSentinel hasMore={list.hasMore} isLoading={list.isFetchingMore} onLoadMore={list.loadMore} />
        </>
      )}
    </PageShell>
  );
}
