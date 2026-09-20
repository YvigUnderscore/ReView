// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { qk } from '../../../lib/query';
import { useInfiniteList } from '../../../lib/useInfiniteList';
import AssignedTaskRow from '../../../components/AssignedTaskRow';
import ListSentinel from '../../../components/ListSentinel';
import { SkeletonRows } from '../../../components/ui/skeleton';
import type { MyTaskItem } from '../../mywork/myWorkTypes';
import { useT } from '../../../i18n';

/**
 * Ce que ce projet me demande à moi — la seule question qu'un artiste vient poser à la vue
 * d'ensemble, et à laquelle la page ne répondait pas.
 *
 * La liste est celle de « mes tâches », vue par le trou d'un projet : même route, même
 * périmètre serveur (`lib/homeScope`), même ligne actionnable. Deux lectures différentes
 * auraient fini par donner deux chiffres différents pour la même question.
 */
export default function MyTasksWidget({ projectId }: { projectId: number }) {
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
        {list.data.map((task) => (
          <AssignedTaskRow key={task.id} task={task} />
        ))}
      </div>
      <ListSentinel hasMore={list.hasMore} isLoading={list.isFetchingMore} onLoadMore={list.loadMore} />
    </>
  );
}
