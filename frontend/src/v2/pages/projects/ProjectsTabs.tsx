// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../../i18n';

export type ProjectsTab = 'active' | 'archived';

/** Active / Archived toggle on the Projects page (38.B, managers only). */
export default function ProjectsTabs({
  tab,
  onChange,
}: {
  tab: ProjectsTab;
  onChange: (t: ProjectsTab) => void;
}) {
  const t = useT();
  const cls = (active: boolean) =>
    `rounded px-2.5 py-1 ${active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`;
  return (
    <div className="flex rounded-md border border-border p-0.5 text-sm">
      <button type="button" onClick={() => onChange('active')} className={cls(tab === 'active')}>
        {t('projects.tab.active')}
      </button>
      <button type="button" onClick={() => onChange('archived')} className={cls(tab === 'archived')}>
        {t('project.archived')}
      </button>
    </div>
  );
}
