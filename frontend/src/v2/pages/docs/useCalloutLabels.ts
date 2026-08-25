// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { useT } from '../../i18n';
import type { CalloutLabels } from './docsRender';

/**
 * Libellés des encarts `> [!NOTE]` du markdown, dans la langue du lecteur.
 *
 * Le contenu de la documentation reste en anglais ; l'habillage, lui, suit l'interface —
 * et il est le même partout où l'on rend du markdown du dépôt (page /docs, panneau des
 * nouveautés).
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
