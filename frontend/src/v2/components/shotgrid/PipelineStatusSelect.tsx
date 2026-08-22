// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { usePipelineStatuses } from '../../lib/shotgridApi';
import { useT } from '../../i18n';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY, TASK_STATUS_COLOR } from '../../lib/taskStatus';
import type { TaskStatus } from '../../types/api';

/**
 * Sélecteur de statut, dans le vocabulaire du projet.
 *
 * Le référentiel `PipelineStatus` existait déjà — la synchronisation ShotGrid le
 * remplissait fidèlement — mais aucun sélecteur ne le lisait : tous proposaient les six
 * valeurs figées de l'énumération. Un superviseur travaillant sur un projet ShotGrid ne
 * pouvait donc pas poser « Ready to Start » ni « On Hold », et voyait « Approved » là où
 * son site dit « Supervisor Approved ».
 *
 * Le repli sur les six statuts figés reste, et sert deux fois : le temps que la requête
 * réponde, et pour un studio dont le référentiel n'a jamais été rempli.
 */
export default function PipelineStatusSelect({
  projectId,
  scope,
  statusId,
  legacyStatus,
  onChange,
  className = '',
  disabled,
}: {
  projectId: number;
  /** Une séquence porte son propre vocabulaire de statuts, distinct de celui d'un plan (C3). */
  scope: 'task' | 'shot' | 'sequence';
  /** Statut du référentiel, quand l'entité en porte un. */
  statusId: number | null | undefined;
  /** Valeur de l'énumération, seule information disponible sur les entités anciennes. */
  legacyStatus?: TaskStatus | null;
  onChange: (next: { statusId: number | null; legacyStatus: TaskStatus }) => void;
  className?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const { data: statuses = [] } = usePipelineStatuses(scope, projectId);

  if (statuses.length === 0) {
    // Repli : le vocabulaire figé, tant qu'aucun référentiel n'est disponible.
    return (
      <select
        aria-label={t('common.status')}
        value={legacyStatus ?? 'TODO'}
        disabled={disabled}
        onChange={(e) => onChange({ statusId: null, legacyStatus: e.target.value as TaskStatus })}
        className={`rounded px-1 py-0.5 text-xs ${TASK_STATUS_COLOR[legacyStatus ?? 'TODO'] ?? ''} ${className}`}
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(TASK_STATUS_LABEL_KEY[s])}
          </option>
        ))}
      </select>
    );
  }

  // L'entité peut ne porter que son ancienne valeur : on retrouve alors le statut du
  // référentiel qui la représente, plutôt que d'afficher une liste sans sélection.
  const current =
    statuses.find((s) => s.id === statusId) ??
    (legacyStatus ? statuses.find((s) => s.legacyStatus === legacyStatus) : undefined);

  return (
    // `title` porte le code du référentiel : c'est une précision, pas un nom. Sans
    // `aria-label`, une page de kanban annonçait autant de « listes déroulantes » que de
    // cartes — le sélecteur de statut est présent sur chacune.
    <select
      aria-label={t('common.status')}
      value={current?.id ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const next = statuses.find((s) => s.id === Number(e.target.value));
        if (next) onChange({ statusId: next.id, legacyStatus: next.legacyStatus ?? 'TODO' });
      }}
      style={current ? { backgroundColor: `${current.color}22`, color: current.color } : undefined}
      className={`rounded px-1 py-0.5 text-xs ${className}`}
      title={current?.code}
    >
      {!current && <option value="">{t('pipeline.status.none')}</option>}
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
