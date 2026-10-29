// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChangelogEntry } from '../lib/changelog';
import { renderDocHtml } from '../pages/docs/docsRender';
import { useCalloutLabels } from '../pages/docs/useCalloutLabels';
import { sanitizeHtml } from '@/v2/lib/sanitizeHtml';

/**
 * The changelog entries, rendered. Loaded lazily by `WhatsNew` when the dialog opens: `marked`
 * (via docsRender) and DOMPurify have no place in the first load of every page.
 */
export default function WhatsNewEntries({ entries }: { entries: ChangelogEntry[] }) {
  const calloutLabels = useCalloutLabels();
  return entries.map((e) => (
    <div key={e.id}>
      <p className="mb-2 text-xs font-semibold section-label text-primary">{e.id}</p>
      <article
        className="prose-doc max-w-none text-sm text-card-foreground"
        // Repo markdown (CHANGELOG.md); raw HTML is escaped by renderDocHtml, then sanitized.
        dangerouslySetInnerHTML={{
          __html: sanitizeHtml(renderDocHtml(e.body, 'CHANGELOG.md', calloutLabels)),
        }}
      />
    </div>
  ));
}
