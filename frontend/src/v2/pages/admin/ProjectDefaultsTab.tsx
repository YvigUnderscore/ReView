// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { SkeletonRows } from '../../components/ui/skeleton';
import { QueryState } from '../../components/ui/query-state';
import DepartmentsEditor from '../../components/DepartmentsEditor';
import ProjectNamingSection from '../../components/ProjectNamingSection';
import ProjectReviewRequestSection from '../../components/ProjectReviewRequestSection';
import ProjectDefaultLightingSection from '../../components/ProjectDefaultLightingSection';
import ProjectColorSection from '../../components/ProjectColorSection';
import { sameValue } from '../../lib/projectInheritance';
import { DRAFT_MODE_KEY } from '../../lib/draftMode';
import { Panel } from './AdminPrimitives';
import { FormatPanel, NumberingPanel } from './ProjectDefaultsFields';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import SettingsPointer from './SettingsPointer';
import TaskPolicyField, { TASK_POLICY_KEY } from './TaskPolicyField';
import DraftModeField from './DraftModeField';
import { useSaveAction, useStudioSettings } from './useStudioSettings';
import type { Nomenclature, ProjectSettings } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Project defaults: what a project inherits as long as it does not take ownership.
 *
 * The screen only exposed three of the seven truly inheritable sections — numbering,
 * format, departments. The other four (naming convention, 3D lighting, colour,
 * burn-ins) appeared on the project side, with a "INHERITED FROM THE STUDIO" badge, pointing
 * to a studio that no screen allowed setting. All seven are here.
 *
 * The seventh, burn-ins, is not set here: the studio template lives in
 * "Distribution", which owns it. The screen links there rather than offering a
 * second copy — two fields for one value is a value one believes one has changed.
 */
export default function ProjectDefaultsTab() {
  const t = useT();
  const qc = useQueryClient();
  const defaultsQ = useQuery({
    queryKey: qk.admin('project-defaults'),
    queryFn: () =>
      api.get<{ settings: ProjectSettings }>('/api/admin/project-defaults').then((d) => d.settings),
  });
  const settings = useStudioSettings('defaults');
  const [draft, setDraft] = useState<ProjectSettings | null>(null);
  const saved = defaultsQ.data;

  const { busy, save } = useSaveAction(async () => {
    if (draft && saved && !sameValue(saved, draft)) {
      const { settings: fresh } = await api.put<{ settings: ProjectSettings }>(
        '/api/admin/project-defaults',
        draft,
      );
      setDraft(fresh);
      await qc.invalidateQueries({ queryKey: qk.admin('project-defaults') });
    }
    // Read before saving: `commit` empties the draft.
    const touchedDraftMode = settings.draft[DRAFT_MODE_KEY] !== undefined;
    await settings.commit();
    // `draftMode` travels with the studio's public identity: without this invalidation,
    // the interface would keep the old behaviour until the next full reload.
    if (touchedDraftMode) await qc.invalidateQueries({ queryKey: qk.branding });
  }, t('defaults.saved'));

  // Seeds the edit from the server values (state adjustment during render).
  if (saved && !draft) setDraft(saved);
  if (!draft || !saved) return <QueryState query={defaultsQ} skeleton={<SkeletonRows count={3} />} />;

  const setNom = (k: keyof Nomenclature, v: string) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          nomenclature: { ...d.nomenclature, [k]: k === 'padding' || k === 'step' ? Number(v) || 1 : v },
        },
    );
  const setRes = (k: 'width' | 'height', v: string) =>
    setDraft((d) => d && { ...d, resolution: { ...d.resolution, [k]: Number(v) || 1 } });
  const setFps = (v: string) => setDraft((d) => d && { ...d, framerate: Number(v) || 1 });

  const policy = settings.draft[TASK_POLICY_KEY] ?? settings.stored[TASK_POLICY_KEY] ?? '';
  const draftMode = settings.draft[DRAFT_MODE_KEY] ?? settings.stored[DRAFT_MODE_KEY] ?? '';

  return (
    <div className="max-w-2xl">
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">{t('defaults.hint')}</p>

        <NumberingPanel value={draft.nomenclature} onChange={setNom} />

        <FormatPanel
          value={draft}
          onResolution={setRes}
          onFramerate={setFps}
          startFrame={
            <SettingsFields
              fields={settings.fields}
              stored={settings.stored}
              draft={settings.draft}
              units={settings.units}
              onChange={settings.setValue}
              onUnit={settings.setUnit}
            />
          }
        />

        <Panel title={t('defaults.departments')}>
          <DepartmentsEditor
            value={draft.departments}
            onChange={(departments) => setDraft((d) => d && { ...d, departments })}
          />
        </Panel>

        <TaskPolicyField value={policy} onChange={(v) => settings.setValue(TASK_POLICY_KEY, v)} />

        <ProjectNamingSection
          value={draft.naming ?? { pattern: '', mode: 'off' }}
          onChange={(naming) => setDraft((d) => d && { ...d, naming })}
        />

        {/* Publication and brief are read together: one says when the media becomes
            visible, the other what to write to file it. */}
        <DraftModeField value={draftMode} onChange={(v) => settings.setValue(DRAFT_MODE_KEY, v)} />

        <ProjectReviewRequestSection
          value={draft.reviewRequest ?? { requireNote: false, minNoteLength: 5 }}
          onChange={(reviewRequest) => setDraft((d) => d && { ...d, reviewRequest })}
        />

        <ProjectDefaultLightingSection
          value={draft.defaultLighting}
          onChange={(defaultLighting) => setDraft((d) => d && { ...d, defaultLighting })}
        />

        <ProjectColorSection
          value={draft.color}
          onChange={(color) => setDraft((d) => d && { ...d, color })}
        />

        <SettingsPointer section="distribution" label={t('review.delivery')} hint={t('burnin.title')} />
      </div>

      <SaveBar
        dirty={!sameValue(saved, draft) || settings.dirty}
        busy={busy}
        onSave={() => void save()}
        onDiscard={() => {
          setDraft(saved);
          settings.discard();
        }}
      />
    </div>
  );
}
