// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useDepartments } from '../../lib/departmentsApi';
import { statusSwatch } from '../../lib/contrast';
import { useTheme } from '../../stores/useTheme';
import { useT } from '../../i18n';

/**
 * Departments an entity goes through (B1, a screen missing until now, C3).
 *
 * The model, routes and service had existed since wave B; there was simply no place in the interface to say
 * "this asset goes through modeling, texturing and rig". Checkboxes are ticked, and the list sent replaces the
 * previous one.
 */
export default function EntityDepartmentsField({
  projectId,
  value,
  onChange,
  disabled,
}: {
  projectId: number;
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const isDark = useTheme((s) => s.theme) === 'dark';
  const { data: departments = [], isPending } = useDepartments(projectId);

  if (isPending) return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>;
  if (departments.length === 0)
    return <p className="text-xs text-muted-foreground">{t('entity.settings.noDepartment')}</p>;

  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((d) => d !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {departments.map((d) => {
        const on = value.includes(d.id);
        // The department colour comes from the database: normalize it, otherwise a pale yellow used as a
        // background becomes unreadable in the dark theme.
        const swatch = d.color ? statusSwatch(d.color, isDark) : null;
        return (
          <button
            key={d.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => toggle(d.id)}
            style={on && swatch ? swatch : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
              on
                ? swatch
                  ? 'border-transparent'
                  : 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
          >
            {d.name}
          </button>
        );
      })}
    </div>
  );
}
