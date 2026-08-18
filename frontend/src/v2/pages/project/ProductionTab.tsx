// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { ProjectSchedule } from '../../types/api';
import type { ProductionOverview } from '../../types/production';
import ProgressMatrix from '../../components/production/ProgressMatrix';
import AttentionPanel from '../../components/production/AttentionPanel';
import WorkloadPanel from '../../components/production/WorkloadPanel';
import PacePanel from '../../components/production/PacePanel';
import DeadlineCalendar from '../../components/production/DeadlineCalendar';
import SequenceGantt from '../../components/production/SequenceGantt';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { useProjectRole } from '../../lib/useProjectRole';
import { useT, type MessageKey } from '../../i18n';

/**
 * Onglet « Production » (C6) — quatre questions, dans cet ordre.
 *
 * Il alignait huit indicateurs « depuis toujours » (temps moyen par plan, notes par
 * version, décisions cumulées) dont aucun ne disait où en est le projet ni ce qui bloque.
 * Le calendrier et le Gantt restent en dessous : ils répondent au « quand », pas au
 * « où en est-on ».
 */

const WINDOWS = [4, 8, 13, 26] as const;

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

  return (
    <div className="mt-6 space-y-4">
      {overviewQ.error && <p className="text-sm text-destructive">{overviewQ.error.message}</p>}
      {!data ? (
        <SkeletonRows count={6} />
      ) : (
        <>
          <Section titleKey="production.section.where">
            <ProgressMatrix data={data} />
          </Section>

          <AttentionPanel data={data} />

          <Section titleKey="production.section.who">
            <WorkloadPanel data={data} />
          </Section>

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

      {scheduleQ.data && scheduleQ.data.tasks.length > 0 && (
        <>
          <Section titleKey="production.calendar">
            <DeadlineCalendar tasks={scheduleQ.data.tasks} projectId={projectId} canEdit={canManage} />
          </Section>
          <Section titleKey="production.gantt">
            <SequenceGantt tasks={scheduleQ.data.tasks} />
          </Section>
        </>
      )}
    </div>
  );
}
