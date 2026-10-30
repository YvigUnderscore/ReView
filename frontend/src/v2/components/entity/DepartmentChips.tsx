// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DepartmentRef } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * The steps an entity goes through, shown on its card.
 *
 * They were declared in a settings panel and appeared nowhere else: when scanning a grid, it was impossible to
 * see which asset goes through the rig and which stops at modeling. Yet that is exactly what a supervisor looks for.
 *
 * One dot per step, tinted with its colour: the ShotGrid colour when it provides one, hence the same here as
 * there. Beyond four, a counter: a card does not have the width of a whole pipe, and twelve dots are no easier
 * to read than a number.
 */
const MAX_SHOWN = 4;

export default function DepartmentChips({ departments }: { departments: DepartmentRef[] }) {
  const t = useT();
  if (departments.length === 0) return null;
  const shown = departments.slice(0, MAX_SHOWN);
  const hidden = departments.length - shown.length;

  return (
    <span
      className="flex flex-wrap items-center gap-1"
      title={departments.map((d) => d.name).join(' · ')}
      aria-label={t('pipeline.departments')}
    >
      {shown.map((department) => (
        <span
          key={department.id}
          className="rounded px-1 py-px text-2xs leading-tight"
          // The tint comes from the reference data: "groom" is green here as on the site, so the
          // pipe can be read at a glance across both tools.
          style={
            department.color
              ? { backgroundColor: `${department.color}22`, color: department.color }
              : undefined
          }
        >
          {department.name}
        </span>
      ))}
      {hidden > 0 && <span className="text-2xs text-muted-foreground">+{hidden}</span>}
    </span>
  );
}
