import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';

interface OcioConfig {
  id: string;
  name: string;
  kind: 'studio' | 'cg';
  acesVersion: string;
  releaseTag: string;
  isDefault: boolean;
}

interface OcioAsset {
  assetName: string;
  sizeBytes: number;
  label: string;
  installed: boolean;
  recommendedDefault: boolean;
  info: { acesVersion: string };
}

interface OcioRelease {
  tag: string;
  name: string;
  publishedAt: string | null;
  assets: OcioAsset[];
}

/**
 * Gestion de couleur OCIO (39.B) : récupère les configs ACES officielles depuis les releases
 * GitHub de l'ASWF, les installe dans le studio et fixe la config par défaut (ACES 1.3). Les
 * projets choisissent ensuite leur display/view dans leurs réglages.
 */
export default function OcioTab() {
  const qc = useQueryClient();
  const [browse, setBrowse] = useState(false);
  const [busyAsset, setBusyAsset] = useState<string | null>(null);

  const configsQ = useQuery({
    queryKey: qk.admin('ocio-configs'),
    queryFn: () => api.get<{ configs: OcioConfig[] }>('/api/studio/ocio/configs').then((d) => d.configs),
  });
  const releasesQ = useQuery({
    queryKey: qk.admin('ocio-releases'),
    queryFn: () => api.get<{ releases: OcioRelease[] }>('/api/studio/ocio/releases').then((d) => d.releases),
    enabled: browse,
  });
  const refreshConfigs = () => qc.invalidateQueries({ queryKey: qk.admin('ocio-configs') });

  const install = async (tag: string, asset: OcioAsset) => {
    setBusyAsset(asset.assetName);
    try {
      await api.post('/api/studio/ocio/install', { tag, assetName: asset.assetName });
      toast.success(`« ${asset.label} » installée`);
      refreshConfigs();
      qc.invalidateQueries({ queryKey: qk.admin('ocio-releases') });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Installation impossible');
    } finally {
      setBusyAsset(null);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await api.put(`/api/studio/ocio/configs/${id}/default`, {});
      refreshConfigs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action impossible');
    }
  };

  const remove = async (id: string, name: string) => {
    try {
      await api.del(`/api/studio/ocio/configs/${id}`);
      toast.success(`« ${name} » supprimée`);
      refreshConfigs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible');
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Configs de gestion de couleur OCIO. Récupérez les configs ACES officielles (
        <a
          href="https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          ASWF OpenColorIO-Config-ACES
        </a>
        ) et définissez la config par défaut du studio (ACES&nbsp;1.3 recommandé).
      </p>

      <Panel title="Configs installées">
        {configsQ.data === undefined ? (
          <SkeletonRows count={2} />
        ) : configsQ.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune config installée. Parcourez les releases ACES ci-dessous.
          </p>
        ) : (
          <div className="space-y-1.5">
            {configsQ.data.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  ACES {c.acesVersion}
                </span>
                <button
                  onClick={() => setDefault(c.id)}
                  title={c.isDefault ? 'Config par défaut du studio' : 'Définir par défaut'}
                  aria-pressed={c.isDefault}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                    c.isDefault
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <Star size={13} className={c.isDefault ? 'fill-current' : ''} />
                  {c.isDefault ? 'Défaut' : ''}
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

      <Panel title="Releases ACES (GitHub)">
        {!browse ? (
          <Button onClick={() => setBrowse(true)}>
            <RefreshCw size={15} /> Parcourir les releases ACES
          </Button>
        ) : releasesQ.isLoading ? (
          <SkeletonRows count={3} />
        ) : releasesQ.isError ? (
          <p className="text-sm text-destructive">Impossible de contacter GitHub. Réessayez plus tard.</p>
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
                      {a.recommendedDefault && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase text-primary">
                          défaut conseillé
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
                          ? 'Installée'
                          : busyAsset === a.assetName
                            ? 'Installation…'
                            : 'Installer'}
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
