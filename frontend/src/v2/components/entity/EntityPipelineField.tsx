// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import PipelineFields from '../../pages/project/PipelineFields';
import { applyOverride, type PipelineForm } from '../../pages/project/pipelineForm';
import type { PipelineOverride, PipelineSettings } from '../../types/api';
import type { ProjectSettings } from '../../pages/project/projectTypes';

/**
 * Réglages pipeline propres d'une séquence ou d'un plan (résolution, cadence), dans le
 * panneau de réglages unifié (C3/C4).
 *
 * Ils vivaient dans deux boîtes d'édition séparées, qui recevaient le socle hérité de la
 * page projet. Le panneau s'ouvre désormais depuis n'importe où — une liste, une page
 * d'entité, la palette — et va donc chercher lui-même le socle du projet : sans lui, le
 * mode « hériter » afficherait 1920×1080 à 24 i/s quel que soit le projet.
 *
 * L'héritage d'un plan passe par sa séquence, quand il en a une : c'est la règle du
 * pipe (studio → projet → séquence → plan).
 */
export default function EntityPipelineField({
  projectId,
  sequenceOverride,
  form,
  onChange,
  idPrefix,
}: {
  projectId: number;
  /** Override de la séquence porteuse, pour un plan. */
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
