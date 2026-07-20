import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, CalendarDays, GanttChartSquare } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { ProjectStats, ProjectSchedule } from '../../types/api';
import ReviewStatsPanel from '../../components/production/ReviewStatsPanel';
import DeadlineCalendar from '../../components/production/DeadlineCalendar';
import SequenceGantt from '../../components/production/SequenceGantt';

type View = 'stats' | 'calendar' | 'gantt';

const VIEWS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: 'stats', label: 'Statistiques', icon: <BarChart3 size={15} /> },
  { key: 'calendar', label: 'Calendrier', icon: <CalendarDays size={15} /> },
  { key: 'gantt', label: 'Gantt', icon: <GanttChartSquare size={15} /> },
];

/** Onglet « Production » de la page projet (Phase 43) — stats (43.A), calendrier & Gantt (43.C). */
export default function ProductionTab({ projectId }: { projectId: number }) {
  const [view, setView] = useState<View>('stats');

  const statsQ = useQuery({
    queryKey: qk.projectStats(projectId),
    queryFn: () => api.get<ProjectStats>(`/api/projects/${projectId}/stats`),
    enabled: view === 'stats',
  });
  const scheduleQ = useQuery({
    queryKey: qk.projectSchedule(projectId),
    queryFn: () => api.get<ProjectSchedule>(`/api/projects/${projectId}/schedule`),
    enabled: view === 'calendar' || view === 'gantt',
  });

  const active = view === 'stats' ? statsQ : scheduleQ;

  return (
    <div className="mt-6 space-y-4">
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === v.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {v.icon}
            {v.label}
          </button>
        ))}
      </div>

      {active.error && <p className="text-sm text-destructive">{active.error.message}</p>}
      {active.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}

      {view === 'stats' && statsQ.data && <ReviewStatsPanel stats={statsQ.data} projectId={projectId} />}
      {view === 'calendar' && scheduleQ.data && <DeadlineCalendar tasks={scheduleQ.data.tasks} />}
      {view === 'gantt' && scheduleQ.data && <SequenceGantt tasks={scheduleQ.data.tasks} />}

      {(view === 'calendar' || view === 'gantt') && scheduleQ.data && scheduleQ.data.tasks.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Aucune tâche datée. Ajoutez une échéance depuis une tâche (menu de la tâche) pour la voir ici.
        </p>
      )}
    </div>
  );
}
