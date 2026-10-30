// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { useT } from '../../i18n';
import type { CalloutLabels } from './docsRender';

/**
 * Labels of the `> [!NOTE]` callouts in markdown, in the reader's language.
 *
 * The documentation content stays in English; the chrome, however, follows the interface. It is
 * the same wherever repo markdown is rendered (the /docs page, the what's-new panel).
 */
export function useCalloutLabels(): CalloutLabels {
  const t = useT();
  return useMemo(
    () => ({
      note: t('docs.calloutNote'),
      tip: t('docs.calloutTip'),
      important: t('docs.calloutImportant'),
      warning: t('docs.calloutWarning'),
      caution: t('docs.calloutCaution'),
    }),
    [t],
  );
}
