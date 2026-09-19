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
 * « Mes tâches », tous projets confondus — la page que déplient les deux compteurs
 * personnels de l'Accueil.
 *
 * Ils pointaient l'ancre `#my-tasks` : elle disparaissait avec le bloc « mes tâches » dès
 * qu'on le retirait de son accueil, et le clic ne faisait plus rien. Une page a l'avantage
 * d'exister quelle que soit la disposition de l'accueil de chacun — et de pouvoir être
 * mise en favori, partagée, rouverte.
 *
 * Le périmètre est celui du compteur (`lib/homeScope`) : projet accessible, hors corbeille,
 * parent non masqué. Le filtre vit dans l'URL, pas dans un état local : c'est ce qui permet
 * à la carte « my retakes » d'ouvrir directement sa vue.
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
