// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { renderDocHtml } from '../docs/docsRender';
import { useCalloutLabels } from '../docs/useCalloutLabels';
import { useT, intlLocale, type Tr } from '../../i18n';
import { Panel, Row } from './AdminPrimitives';
import { displayVersion, formatBuildDate } from './aboutInstance';
import { releaseErrorLabel, type OpsOverview, type ReleaseInfo } from './ops';

/**
 * Ce que fait tourner cette instance, ce qui est paru depuis, et ce que ça change.
 *
 * Les notes de version viennent du dépôt suivi : c'est du markdown **distant**, rendu par
 * `renderDocHtml`, qui échappe le HTML brut. Un dépôt tiers n'injecte donc rien dans
 * l'écran d'administration de personne.
 */
export default function ReleasePanel({ overview }: { overview: OpsOverview }) {
  const t = useT();
  const qc = useQueryClient();

  const refresh = useMutation({
    mutationFn: () => api.post('/api/admin/ops/releases/refresh'),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.adminOps }),
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('common.error.generic')),
  });

  const { current, latest, newer, release, updateAvailable, mode, mechanism } = overview;
  const built = formatBuildDate(current.builtAt);
  const errorText = releaseErrorLabel(t, release.error);

  return (
    <>
      <Panel title={t('about.title')}>
        <dl className="space-y-1 text-sm">
          <Row label={t('about.version')} value={displayVersion(current)} />
          <Row label={t('about.builtAt')} value={built ?? t('about.builtAtUnknown')} />
          <Row label={t('about.runtime')} value={current.node} />
          <Row
            label={t('ops.installed.delivery')}
            value={mode === 'registry' ? t('ops.installed.registry') : t('ops.installed.build')}
          />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {mode === 'build' ? t('ops.installed.buildHint') : t('about.hint')}
        </p>
        {mechanism.agentVersion && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('ops.agent.version', { value: mechanism.agentVersion })}
          </p>
        )}
      </Panel>

      <Panel title={t('ops.latest.title')}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {updateAvailable && latest ? (
            <Badge variant="warning">{t('ops.latest.available', { tag: latest.tag })}</Badge>
          ) : (
            !errorText && <Badge variant="success">{t('ops.latest.upToDate')}</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {release.checkedAt
              ? t('ops.latest.checkedAt', { date: formatMoment(release.checkedAt) })
              : t('ops.latest.never')}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw size={13} className={refresh.isPending ? 'animate-spin' : undefined} />
            {t('common.refresh')}
          </Button>
        </div>

        {errorText && <p className="mb-3 text-xs text-warning">{errorText}</p>}

        <ChangeList releases={newer} t={t} />
      </Panel>
    </>
  );
}

/** Date lisible dans la langue du lecteur — jamais un ISO brut, jamais un fuseau imposé. */
function formatMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Toutes les versions parues depuis celle en service, pas seulement la dernière : sauter
 * trois versions d'un coup est le cas courant, et ce qui change vient alors des trois.
 */
function ChangeList({ releases, t }: { releases: ReleaseInfo[]; t: Tr }) {
  const calloutLabels = useCalloutLabels();

  if (releases.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('ops.changes.none')}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold section-label text-muted-foreground">
        {t('ops.changes.title')} — {t('ops.changes.count', { count: releases.length })}
      </p>
      {releases.map((entry, index) => (
        <details key={entry.tag} open={index === 0} className="rounded-md border border-border">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <code className="font-mono text-xs">{entry.tag}</code>
            <span className="text-muted-foreground">{entry.name}</span>
            {entry.prerelease && <Badge variant="muted">{t('ops.changes.prerelease')}</Badge>}
            {entry.publishedAt && (
              <span className="ml-auto text-xs text-muted-foreground">
                {t('ops.latest.published', { date: formatMoment(entry.publishedAt) })}
              </span>
            )}
          </summary>
          <div className="border-t border-border px-3 py-2">
            <article
              className="prose-doc max-w-none text-sm text-card-foreground"
              // Markdown d'un dépôt distant : `renderDocHtml` échappe le HTML brut.
              dangerouslySetInnerHTML={{
                __html: renderDocHtml(entry.notesMd, 'CHANGELOG.md', calloutLabels),
              }}
            />
            <a
              href={entry.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-primary"
            >
              <ExternalLink size={12} /> {t('common.open')}
            </a>
          </div>
        </details>
      ))}
    </div>
  );
}
