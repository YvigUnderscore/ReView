// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { FileQuestion, Lock, RotateCcw, TriangleAlert } from 'lucide-react';
import { ApiError } from '../../lib/apiClient';
import { isMissingOrForbidden } from './entityAvailability';
import { useT } from '../i18n';
import { Button } from './ui/button';
import PageShell from './PageShell';

/**
 * What an entity page shows when its subject does not exist, is not accessible, or
 * could not be loaded.
 *
 * Without it, an entity page rendered its shell with null data: `/shots/999999`
 * displayed "Shots #999999" and offered "+ New version" and "Attach an asset"
 * on a shot that does not exist; `/tasks/abc` went as far as "Task #NaN" with an active
 * file drop zone. The public pages (sharing, invitation) already handled
 * the case correctly: it is the same care, applied to the internal pages.
 *
 * Three situations, three messages: the entity does not exist (404), it is not open
 * to us (403), or the server did not respond. Only in the last case is there a
 * "Retry" button, because that is the only case where retrying makes sense.
 */

export type EntityKind = 'shot' | 'sequence' | 'episode' | 'asset' | 'task' | 'project' | 'media';

interface Props {
  kind: EntityKind;
  /** The error surfaced by the query; absent when the identifier itself is invalid. */
  error?: unknown;
  onRetry?: () => void;
}

export default function EntityUnavailable({ kind, error, onRetry }: Props) {
  const t = useT();
  const forbidden = error instanceof ApiError && error.status === 403;
  const serverIssue = error !== undefined && !isMissingOrForbidden(error);

  const Icon = forbidden ? Lock : serverIssue ? TriangleAlert : FileQuestion;
  const title = forbidden
    ? t('entity.unavailable.forbidden')
    : serverIssue
      ? t('entity.unavailable.failed')
      : t(`entity.unavailable.missing.${kind}`);
  const hint = forbidden
    ? t('entity.unavailable.forbidden.hint')
    : serverIssue
      ? t('entity.unavailable.failed.hint')
      : t('entity.unavailable.missing.hint');

  return (
    <PageShell title={title}>
      <div className="flex min-h-[14rem] flex-col items-center justify-center gap-3 text-center">
        <Icon size={28} className="text-muted-foreground" aria-hidden />
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
        <div className="mt-1 flex gap-2">
          {serverIssue && onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw size={14} /> {t('error.boundary.retry')}
            </Button>
          )}
          <Button asChild size="sm">
            <Link to="/projects">{t('entity.unavailable.backToProjects')}</Link>
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
