// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { QueryState } from '../../components/ui/query-state';
import { Panel } from './AdminPrimitives';
import { useT } from '../../i18n';
import { ocioApi, useOcioConfigsQuery, useOcioReleasesQuery, type OcioAsset } from '@/v2/lib/ocioApi';

/**
 * OCIO colour management (39.B): fetches the official ACES configs from the
 * ASWF's GitHub releases, installs them on the studio and sets the default config (ACES 1.3). Projects
 * then pick their display/view in their own settings.
 */
export default function OcioTab() {
  const t = useT();
  const qc = useQueryClient();
  const [browse, setBrowse] = useState(false);
  const [busyAsset, setBusyAsset] = useState<string | null>(null);

  const configsQ = useOcioConfigsQuery();
  const releasesQ = useOcioReleasesQuery(browse);
  const refreshConfigs = () => qc.invalidateQueries({ queryKey: qk.ocioConfigs });

  const install = async (tag: string, asset: OcioAsset) => {
    setBusyAsset(asset.assetName);
    try {
      await ocioApi.install(tag, asset.assetName);
      toast.success(t('ocio.configInstalled', { name: asset.label }));
      void refreshConfigs();
      void qc.invalidateQueries({ queryKey: qk.admin('ocio-releases') });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.install'));
    } finally {
      setBusyAsset(null);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await ocioApi.setDefault(id);
      void refreshConfigs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.action'));
    }
  };

  const remove = async (id: string, name: string) => {
    try {
      await ocioApi.remove(id);
      toast.success(t('ocio.configDeleted', { name }));
      void refreshConfigs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.delete'));
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        {t('ocio.intro')}
        <a
          href="https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          <code>ASWF OpenColorIO-Config-ACES</code>
        </a>
        {t('ocio.hintEnd')}
      </p>

      <Panel title={t('ocio.installed')}>
        {configsQ.data === undefined ? (
          <QueryState query={configsQ} skeleton={<SkeletonRows count={2} />} compact />
        ) : configsQ.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('ocio.none')}</p>
        ) : (
          <div className="space-y-1.5">
            {configsQ.data.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-2xs uppercase text-muted-foreground">
                  ACES {c.acesVersion}
                </span>
                <button
                  onClick={() => setDefault(c.id)}
                  title={c.isDefault ? t('ocio.studioDefault') : t('ocio.setDefault')}
                  aria-pressed={c.isDefault}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                    c.isDefault
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <Star size={13} className={c.isDefault ? 'fill-current' : ''} />
                  {c.isDefault ? t('common.default') : ''}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(c.id, c.name)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={t('ocio.acesReleases')}>
        {!browse ? (
          <Button onClick={() => setBrowse(true)}>
            <RefreshCw size={15} /> {t('ocio.browse')}
          </Button>
        ) : releasesQ.isLoading ? (
          <SkeletonRows count={3} />
        ) : releasesQ.isError ? (
          <QueryState query={releasesQ} description={t('ocio.githubUnreachable')} compact />
        ) : (
          <div className="space-y-4">
            {(releasesQ.data ?? []).map((r) => (
              <div key={r.tag}>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{r.name}</div>
                <div className="space-y-1.5">
                  {r.assets.map((a) => (
                    <div
                      key={a.assetName}
                      className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{a.label}</span>
                      {/* Badge, not a section label: it is read by its solid fill, not by its casing. */}
                      {a.recommendedDefault && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-2xs text-primary">
                          {t('ocio.recommended')}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant={a.installed ? 'ghost' : 'default'}
                        disabled={a.installed || busyAsset !== null}
                        onClick={() => install(r.tag, a)}
                      >
                        <Download size={14} />
                        {a.installed
                          ? t('ocio.installedBadge')
                          : busyAsset === a.assetName
                            ? t('common.installing')
                            : t('common.install')}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
