// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { qk } from '../../lib/query';
import { t } from '../../i18n';
import type { DocsManifest } from './docsManifest';

/**
 * Table of contents of the documentation, shared by the `/docs` page and the Ctrl+K palette.
 *
 * The manifest is a static file produced at build time (`scripts/build-docs.mjs`) and served by
 * the frontend: it does not go through the API, depends on no session, and never changes during
 * the life of the tab. Hence `staleTime: Infinity` and a single key, so that the palette reuses
 * what the documentation page has already loaded, and vice versa.
 *
 * `enabled` exists for the palette: it must not fetch seventy page titles while nobody has typed
 * anything.
 */
export function useDocsManifest(enabled = true) {
  return useQuery({
    queryKey: qk.docsManifest(),
    queryFn: async (): Promise<DocsManifest> => {
      const res = await fetch('/docs/manifest.json');
      if (!res.ok) throw new Error(t('docs.unavailable', { status: res.status }));
      return (await res.json()) as DocsManifest;
    },
    staleTime: Infinity,
    enabled,
  });
}
