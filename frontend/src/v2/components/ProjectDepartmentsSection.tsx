// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DepartmentSummary } from '../types/api';
import { useT } from '../i18n';
import DepartmentsEditor from './DepartmentsEditor';
import DepartmentImages from './DepartmentImages';
import { ListOrdered } from 'lucide-react';
import { SettingsCard } from './settings/SettingsCard';
import { SETTINGS_KEYWORDS } from './settings/settingsKeywords';

/**
 * Départements du projet (B1) : des entités à part entière, éditables même sur un projet
 * relié. L'éditeur était verrouillé avec la mention « hérité de ShotGrid », alors qu'aucun
 * code ne les synchronisait : le studio se retrouvait devant un champ mort. Les étapes
 * importées du site sont désormais créées à la volée à l'import ; le studio reste libre de
 * les nommer, de les ordonner et d'en ajouter.
 *
 * Les clés et les noms vivent dans le brouillon de réglages ; les images, non — elles
 * s'enregistrent seules, département par département.
 */
export default function ProjectDepartmentsSection({
  projectId,
  value,
  onChange,
}: {
  projectId: number;
  value: DepartmentSummary[] | null;
  onChange: (departments: DepartmentSummary[]) => void;
}) {
  const t = useT();

  return (
    <SettingsCard
      title={t('pipeline.departments')}
      hint={t('project.departmentsHint')}
      icon={ListOrdered}
      tone="primary"
      keywords={SETTINGS_KEYWORDS.departments}
      footnote={t('departments.keyLocked')}
    >
      {value && <DepartmentsEditor value={value} onChange={onChange} />}
      <div className="mt-4 border-t border-border pt-3">
        <DepartmentImages projectId={projectId} />
      </div>
    </SettingsCard>
  );
}
