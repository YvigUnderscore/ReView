// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSearchParams } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { qk } from '../lib/query';
import { useInfiniteList } from '../lib/useInfiniteList';
import PageShell from '../components/PageShell';
import AssignedTaskRow from '../components/AssignedTaskRow';
import ListSentinel, { ListCount } from '../components/ListSentinel';
import EmptyState from '../components/ui/empty-state';
import { SkeletonCards } from '../components/ui/skeleton';
import { Select } from '../components/ui/select';
import type { MyTaskItem } from './mywork/myWorkTypes';
import { useT } from '../i18n';

/**
 * "My tasks", across all projects — the page that the two personal counters
 * on the Home page expand into.
 *
 * They pointed to the `#my-tasks` anchor: it disappeared along with the "my tasks" block as soon
 * as it was removed from one's home page, and the click then did nothing. A page has the advantage
 * of existing whatever each person's home layout — and of being
 * bookmarkable, shareable, reopenable.
 *
 * The scope is that of the counter (`lib/homeScope`): accessible project, outside the trash,
 * parent not hidden. The filter lives in the URL, not in local state: this is what lets the
 * "my retakes" card open its view directly.
 */
export default function MyTasksPage() {
  const t = useT();
  const [search, setSearch] = useSearchParams();
  const blocked = search.get('scope') === 'blocked';
  const qs = blocked ? 'scope=blocked' : '';
  const list = useInfiniteList<MyTaskItem>(qk.myTasks(qs), `/api/dashboard/tasks${qs ? `?${qs}` : ''}`, {
    keepPrevious: true,
  });
  const { data: items, error } = list;

  return (
    <PageShell title={t('home.myTasks')}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('home.myTasks')}</h1>
        <Select
          value={blocked ? 'blocked' : 'all'}
          onChange={(e) => setSearch(e.target.value === 'blocked' ? { scope: 'blocked' } : {})}
          aria-label={t('mywork.tasks.scopeAll')}
          className="text-xs"
        >
          <option value="all">{t('mywork.tasks.scopeAll')}</option>
          <option value="blocked">{t('home.stat.myRetakes')}</option>
        </Select>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}

      {items === undefined ? (
        <SkeletonCards />
      ) : items.length === 0 ? (
        <EmptyState icon={ListTodo} title={blocked ? t('mywork.tasks.noRetake') : t('home.noAssignedTask')} />
      ) : (
        <>
          <ListCount loaded={list.loaded} total={list.total} label={t('task.count', { count: list.total })} />
          <div className="space-y-1 rounded-lg border border-border bg-card p-2">
            {items.map((task) => (
              <AssignedTaskRow key={task.id} task={task} />
            ))}
          </div>
          <ListSentinel hasMore={list.hasMore} isLoading={list.isFetchingMore} onLoadMore={list.loadMore} />
        </>
      )}
    </PageShell>
  );
}
