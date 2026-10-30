// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useT } from '../../i18n';
import type { AdminSectionKey } from './adminSections';

/**
 * The pointer to the screen that is authoritative for a setting.
 *
 * The same setting used to be configured in several places — trash retention in
 * "Studio" and log retention in "Maintenance", the studio logo in
 * "Distribution" although the login page shows it too. Two fields for a single
 * value is a value one believes one has changed. A single screen now holds it;
 * the others say where it lives, and do not offer a second copy.
 */
export default function SettingsPointer({
  section,
  label,
  hint,
}: {
  /** Authoritative section — its key **is** its route. */
  section: AdminSectionKey;
  /** Name of this section, as the sidebar displays it. */
  label: string;
  /** What is configured there, stated in the words of the current screen. */
  hint?: string;
}) {
  const t = useT();
  return (
    <p className="flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
      {hint && <span>{hint}</span>}
      <Link
        to={`/admin/${section}`}
        className="inline-flex items-center gap-0.5 text-primary hover:underline"
      >
        {t('settings.setIn', { section: label })}
        <ArrowUpRight size={12} />
      </Link>
    </p>
  );
}
