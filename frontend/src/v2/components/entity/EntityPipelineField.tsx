// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import PipelineFields from '../../pages/project/PipelineFields';
import { applyOverride, type PipelineForm } from '../../pages/project/pipelineForm';
import type { PipelineOverride, PipelineSettings } from '../../types/api';
import type { ProjectSettings } from '../../pages/project/projectTypes';

/**
 * Own pipeline settings of a sequence or shot (resolution, frame rate), in the unified settings panel (C3/C4).
 *
 * They used to live in two separate edit boxes, which received the inherited base from the project page. The
 * panel now opens from anywhere (a list, an entity page, the palette), so it fetches the project's base itself:
 * without it, the "inherit" mode would show 1920×1080 at 24 fps whatever the project.
 *
 * A shot's inheritance goes through its sequence when it has one: this is the pipe's rule (studio → project →
 * sequence → shot).
 */
export default function EntityPipelineField({
  projectId,
  sequenceOverride,
  form,
  onChange,
  idPrefix,
}: {
  projectId: number;
  /** Override of the owning sequence, for a shot. */
  sequenceOverride?: PipelineOverride;
  form: PipelineForm;
  onChange: (next: PipelineForm) => void;
  idPrefix: string;
}) {
  const { data } = useQuery({
    queryKey: qk.projectSettings(projectId),
    queryFn: () =>
      api.get<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`).then((d) => d.settings),
    enabled: projectId > 0,
    staleTime: 5 * 60_000,
  });

  const base: PipelineSettings = {
    resolution: data?.resolution ?? { width: 1920, height: 1080 },
    framerate: data?.framerate ?? 24,
  };
  const inherited = applyOverride(base, sequenceOverride);

  return <PipelineFields inherited={inherited} form={form} onChange={onChange} idPrefix={idPrefix} />;
}
