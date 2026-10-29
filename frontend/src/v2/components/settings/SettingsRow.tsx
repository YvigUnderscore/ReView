// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Hint } from '../ui/hint';

/**
 * A settings row: its name, its help, its control. The label convention of the three families of screens.
 *
 * There used to be three: a 256 px label in a fixed column in administration, a `Label` stacked above the field in the
 * profile, and a grey capital below the field in the projects. The measure of the column therefore changed from one screen
 * to the next, and the help sometimes preceded the control, sometimes followed it.
 *
 * The label is **not** a `<label>`: this row also hosts groups (segmented control, pair of fields) that a `<label>` cannot
 * name without misleading the screen reader. The control carries its own accessible name: `Field` for a single field, `label`
 * for a `SegmentedControl`.
 */
export default function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  /** What the setting changes, when the label is not enough. */
  hint?: string;
  /**
   * `id` of the control when the row carries only one: the label then becomes a real `<label>`, and the field a named
   * field. Absent for a group, which names itself.
   */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {htmlFor ? (
          <label className="text-sm" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="text-sm">{label}</div>
        )}
        {hint && <Hint size="fine">{hint}</Hint>}
      </div>
      {children}
    </div>
  );
}
