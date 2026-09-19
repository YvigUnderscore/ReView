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
 * Le fil des derniers commentaires de mon périmètre.
 *
 * La quatrième carte de l'Accueil compte des commentaires ; elle empruntait son libellé au
 * filtre du fil de review (« All ») et menait à `/reviews`, qui n'en montre aucun. Un
 * compteur doit mener à ses lignes, sinon personne ne peut le contredire.
 *
 * Une ligne = une note (et non un média, comme « dernières reviews ») : c'est ce chiffre-là
 * qu'on déplie. Un CLIENT n'y voit que les notes qui lui sont destinées — le serveur borne,
 * la page ne trie rien.
 */

/** Une note du fil : le texte d'abord, puis où elle a été posée et par qui. */
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
