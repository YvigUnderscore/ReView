// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { qk } from '@/v2/lib/query';
import { useInfiniteList } from '@/v2/lib/useInfiniteList';
import AssignedTaskRow from '@/v2/components/AssignedTaskRow';
import ListSentinel from '@/v2/components/ListSentinel';
import { SkeletonRows } from '@/v2/components/ui/skeleton';
import type { MyTaskItem } from '../../mywork/myWorkTypes';
import { useT } from '@/v2/i18n';

/**
 * What this project asks of me: the one question an artist comes to the overview with, and which
 * the page did not answer.
 *
 * The list is that of "my tasks", seen through the hole of a project: same route, same server
 * scope (`lib/homeScope`), same actionable row. Two different readings would eventually have given
 * two different figures for the same question.
 *
 * `limit` is what the card can show: the height set, translated into rows. The sentinel only
 * remains as long as the card has room: once full, asking for one more page would display nothing
 * more.
 */
export default function MyTasksWidget({ projectId, limit }: { projectId: number; limit: number }) {
  const t = useT();
  const filter = `project=${projectId}`;
  const list = useInfiniteList<MyTaskItem>(qk.myTasks(filter), `/api/dashboard/tasks?projectId=${projectId}`);

  if (list.error) return <p className="text-xs text-destructive">{list.error.message}</p>;
  if (list.data === undefined) return <SkeletonRows count={3} />;
  if (list.data.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        {t('home.noAssignedTask')}{' '}
        <Link to="/my-tasks" className="text-primary hover:underline">
          {t('overview.myTasksElsewhere')}
        </Link>
      </p>
    );

  return (
    <>
      <div className="space-y-1">
        {list.data.slice(0, limit).map((task) => (
          <AssignedTaskRow key={task.id} task={task} />
        ))}
      </div>
      <ListSentinel
        hasMore={list.hasMore && list.data.length < limit}
        isLoading={list.isFetchingMore}
        onLoadMore={list.loadMore}
      />
    </>
  );
}
