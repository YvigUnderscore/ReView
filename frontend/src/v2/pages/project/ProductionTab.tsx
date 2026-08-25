// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CalendarClock, Users } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { ProjectSchedule } from '../../types/api';
import type { ProductionOverview } from '../../types/production';
import ProductionSummary from '../../components/production/ProductionSummary';
import ProgressMatrix from '../../components/production/ProgressMatrix';
import AttentionPanel from '../../components/production/AttentionPanel';
import WorkloadPanel from '../../components/production/WorkloadPanel';
import PacePanel from '../../components/production/PacePanel';
import DeadlineCalendar from '../../components/production/DeadlineCalendar';
import SequenceGantt from '../../components/production/SequenceGantt';
import Tabs, { type TabDef } from '../../components/Tabs';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { useProjectRole } from '../../lib/useProjectRole';
import { useT, type MessageKey } from '../../i18n';

/**
 * Onglet « Production ».
 *
 * Six panneaux étaient empilés, chacun juste, mais il fallait tous les lire pour répondre à
 * la seule question qu'on se pose en ouvrant la page : **est-ce que ça va ?** Et les
 * atteindre demandait de faire défiler trois écrans.
 *
 * D'où deux niveaux. Une **ligne de synthèse**, toujours visible, qui répond en quatre
 * chiffres. Puis des **onglets** — avancement, ce qui bloque, l'équipe, le planning — parce
 * que ces quatre questions ne se posent pas en même temps : un superviseur ouvre
 * « ce qui bloque » le matin, la production ouvre « planning » en fin de semaine.
 *
 * Les badges des onglets portent le nombre d'alertes : on sait où aller sans y aller.
 */

const WINDOWS = [4, 8, 13, 26] as const;

type Panel = 'progress' | 'attention' | 'team' | 'schedule';

function Section({ titleKey, children }: { titleKey: MessageKey; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{t(titleKey)}</h2>
      {children}
    </section>
  );
}

export default function ProductionTab({ projectId }: { projectId: number }) {
  const t = useT();
  const [weeks, setWeeks] = useState<number>(8);
  const [panel, setPanel] = useState<Panel>('progress');
  const { canManage } = useProjectRole(projectId);

  const overviewQ = useQuery({
    queryKey: qk.projectProduction(projectId, weeks),
    queryFn: () => api.get<ProductionOverview>(`/api/projects/${projectId}/production?weeks=${weeks}`),
  });
  const scheduleQ = useQuery({
    queryKey: qk.projectSchedule(projectId),
    queryFn: () => api.get<ProjectSchedule>(`/api/projects/${projectId}/schedule`),
  });

  const data = overviewQ.data;
  if (overviewQ.error) return <p className="mt-6 text-sm text-destructive">{overviewQ.error.message}</p>;
  if (!data) return <SkeletonRows count={6} />;

  const blocking =
    data.attention.overdue.length + data.attention.unassigned.length + data.attention.waitingReview.length;
  const scheduled = scheduleQ.data?.tasks ?? [];

  const tabs: TabDef[] = [
    { key: 'progress', label: t('production.section.where'), icon: <BarChart3 size={14} /> },
    {
      key: 'attention',
      label: t('production.section.attention'),
      icon: <AlertTriangle size={14} />,
      badge: blocking,
    },
    { key: 'team', label: t('production.section.who'), icon: <Users size={14} /> },
    { key: 'schedule', label: t('production.section.schedule'), icon: <CalendarClock size={14} /> },
  ];

  return (
    <div className="mt-6 space-y-4">
      <ProductionSummary data={data} />
      <Tabs tabs={tabs} active={panel} onChange={(key) => setPanel(key as Panel)} />

      {panel === 'progress' && (
        <>
          <Section titleKey="production.section.where">
            <ProgressMatrix data={data} />
          </Section>
          {/* La cadence répond au « à quel rythme », qui prolonge le « où en est-on » :
              les deux se lisent ensemble, pas dans deux onglets séparés. */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('production.section.pace')}</h2>
              <Select
                value={String(weeks)}
                onChange={(e) => setWeeks(Number(e.target.value))}
                className="py-1"
                aria-label={t('production.pace.window')}
              >
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {t('production.pace.weeks', { count: w })}
                  </option>
                ))}
              </Select>
            </div>
            <PacePanel data={data} />
          </section>
        </>
      )}

      {panel === 'attention' && <AttentionPanel data={data} />}

      {panel === 'team' && (
        <Section titleKey="production.section.who">
          <WorkloadPanel data={data} />
        </Section>
      )}

      {panel === 'schedule' &&
        (scheduled.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {t('production.schedule.empty')}
          </p>
        ) : (
          <>
            <Section titleKey="production.calendar">
              <DeadlineCalendar tasks={scheduled} projectId={projectId} canEdit={canManage} />
            </Section>
            <Section titleKey="production.gantt">
              <SequenceGantt tasks={scheduled} />
            </Section>
          </>
        ))}
    </div>
  );
}
