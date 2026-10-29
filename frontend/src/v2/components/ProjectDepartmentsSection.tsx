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
 * Project departments (B1): entities in their own right, editable even on a linked project.
 * The editor was locked with the note "inherited from ShotGrid", although no
 * code synchronized them: the studio was left facing a dead field. The steps
 * imported from the site are now created on the fly at import; the studio remains free to
 * name them, order them and add more.
 *
 * The keys and names live in the settings draft; the images do not: they
 * are saved on their own, department by department.
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
