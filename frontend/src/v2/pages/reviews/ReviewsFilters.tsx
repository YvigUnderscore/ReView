// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useProjectsQuery, useReviewStatusesQuery } from '../../lib/queries';
import { Select } from '../../components/ui/select';
import SavedViewsMenu from '../../components/SavedViewsMenu';
import ViewToggle from '../../components/ViewToggle';
import type { MediaKind } from '../../types/api';
import { filtersFrom, mediaKindLabels, type ReviewsFilterState } from './reviewsTypes';
import { useDraftMode } from '../../lib/draftMode';
import { useT } from '../../i18n';

const KIND_OPTIONS: readonly MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];

/**
 * Bandeau de filtres de la page Reviews.
 *
 * Sorti de la page pour une raison simple : il en occupait la moitié, et la page devait
 * garder de la place pour ce qu'on y fait — ouvrir, décider, ranger.
 */
export default function ReviewsFilters({
  value,
  onChange,
}: {
  value: ReviewsFilterState;
  onChange: (next: ReviewsFilterState) => void;
}) {
  const t = useT();
  const kindLabels = mediaKindLabels(t);
  const draftMode = useDraftMode();
  // Le filtre doit proposer tous les projets, pas les cent premiers : une liste déroulante
  // ne défile pas jusqu'à une sentinelle.
  const { data: projects } = useProjectsQuery({ all: true });
  const { data: reviewStatuses } = useReviewStatusesQuery();
  const set = (patch: Partial<ReviewsFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.projectId}
        onChange={(e) => set({ projectId: e.target.value })}
        aria-label={t('reviews.filter.allProjects')}
        className="text-xs"
      >
        <option value="">{t('reviews.filter.allProjects')}</option>
        {(projects ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select
        value={value.kind}
        onChange={(e) => set({ kind: e.target.value })}
        aria-label={t('reviews.filter.allTypes')}
        className="text-xs"
      >
        <option value="">{t('reviews.filter.allTypes')}</option>
        {KIND_OPTIONS.map((k) => (
          <option key={k} value={k}>
            {kindLabels[k]}
          </option>
        ))}
      </Select>
      {/* Trier le publié du brouillon ne veut dire quelque chose que dans un studio qui
          garde le parcours en deux temps (`draftMode`). Ailleurs, tout média est publié dès
          l'upload : le sélecteur n'offrirait que deux fois la même liste. Il reparaît
          quand un filtre est posé — une vue enregistrée doit pouvoir se défaire. */}
      {(draftMode || value.status !== '') && (
        <Select
          value={value.status}
          onChange={(e) => set({ status: e.target.value })}
          aria-label={t('reviews.filter.publishedAndDrafts')}
          className="text-xs"
        >
          <option value="">{t('reviews.filter.publishedAndDrafts')}</option>
          <option value="published">{t('reviews.filter.published')}</option>
          {(draftMode || value.status === 'draft') && (
            <option value="draft">{t('reviews.filter.myDrafts')}</option>
          )}
        </Select>
      )}
      <Select
        value={value.decision}
        onChange={(e) => set({ decision: e.target.value })}
        aria-label={t('reviews.filter.allDecisions')}
        className="text-xs"
      >
        <option value="">{t('reviews.filter.allDecisions')}</option>
        <option value="none">{t('reviews.filter.noDecision')}</option>
        {(reviewStatuses ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Select
        value={value.assigned}
        onChange={(e) => set({ assigned: e.target.value })}
        aria-label={t('reviews.filter.allAssignments')}
        className="text-xs"
      >
        <option value="">{t('reviews.filter.allAssignments')}</option>
        <option value="me">{t('reviews.assigned.title')}</option>
      </Select>
      <SavedViewsMenu scope="reviews" current={value} onApply={(f) => onChange(filtersFrom(f))} />
      <ViewToggle contextKey="reviews" />
    </div>
  );
}
