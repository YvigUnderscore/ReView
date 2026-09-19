// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DepartmentSummary } from '../types/api';
import { useT } from '../i18n';
import DepartmentsEditor from './DepartmentsEditor';
import DepartmentImages from './DepartmentImages';
import { Card } from './ui/card';

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
    <Card>
      <div className="text-sm font-medium">{t('pipeline.departments')}</div>
      <div className="mb-3 text-xs text-muted-foreground">{t('project.departmentsHint')}</div>
      <div className="mb-3 text-xs text-muted-foreground">{t('departments.keyLocked')}</div>
      {value && <DepartmentsEditor value={value} onChange={onChange} />}
      <div className="mt-4 border-t border-border pt-3">
        <DepartmentImages projectId={projectId} />
      </div>
    </Card>
  );
}
