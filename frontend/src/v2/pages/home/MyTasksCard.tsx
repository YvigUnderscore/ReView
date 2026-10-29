// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import AssignedTaskRow from '../../components/AssignedTaskRow';
import type { DashboardTask } from './homeTypes';
import { useT } from '../../i18n';

/**
 * My assigned tasks (not yet approved), sorted by urgency on the server.
 * Redesign G: an actionable row. Right-click changes the status without leaving the home page
 * (same mutation as the kanban), and the due date is shown when there is one.
 *
 * The block no longer carries the `#my-tasks` anchor: two counters led there, and the anchor
 * vanished with the block as soon as it was removed from the home page, so the click then did
 * nothing. They now open the `/my-tasks` page, which still exists.
 *
 * `limit` is the number of rows the block's size allows (batch 13): enlarging the card really
 * shows more tasks, and the end link leads to the rest.
 */
export default function MyTasksCard({ tasks, limit }: { tasks: DashboardTask[]; limit: number }) {
  const tr = useT();
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
        <ListTodo size={24} />
        {tr('home.noAssignedTask')}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {tasks.slice(0, limit).map((t) => (
        <AssignedTaskRow key={t.id} task={t} />
      ))}
      <Link
        to="/my-tasks"
        className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {tr('refs.seeAll')}
      </Link>
    </div>
  );
}
