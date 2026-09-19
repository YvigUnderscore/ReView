// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import AssignedTaskRow from '../../components/AssignedTaskRow';
import type { DashboardTask } from './homeTypes';
import { useT } from '../../i18n';

/**
 * Mes tâches assignées (non approuvées), triées par urgence côté serveur.
 * Refonte G : ligne actionnable — clic droit pour changer le statut sans quitter
 * l'Accueil (même mutation que le kanban), échéance visible quand elle existe.
 *
 * Le bloc ne porte plus l'ancre `#my-tasks` : deux compteurs y menaient, et l'ancre
 * disparaissait avec le bloc dès qu'on le retirait de son accueil — le clic ne faisait
 * alors rien. Ils ouvrent maintenant la page `/my-tasks`, qui existe toujours.
 */
export default function MyTasksCard({ tasks }: { tasks: DashboardTask[] }) {
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
      {tasks.map((t) => (
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
