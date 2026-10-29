// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

/**
 * A common label above its field, in the weight of the settings panels.
 *
 * The settings sections line up three or four short fields on one row: the
 * `<label>` wraps the control here, so there is no `htmlFor` to forget. The
 * `Field` of `ui/` remains the right tool for a column form, with help and error.
 */
export default function ProjectSettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-2xs section-label text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
