import { useEffect, useState } from 'react';
import type { SplatStats } from '../scene/stats';
import type { SplatViewer } from '../useSplat';
import { HudGroup } from '../../hud/ViewerHud';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

/**
 * Panneau de statistiques du HUD (10.G-V1, togglable) : FPS lissé, splats rendus / total,
 * draw calls. S'abonne à l'échantillonneur du viewer (`subscribeStats`) — aucune mesure
 * quand le panneau est fermé.
 */
export default function StatsPanel({ splat }: { splat: SplatViewer }) {
  const [stats, setStats] = useState<SplatStats | null>(null);
  const { subscribeStats } = splat;
  useEffect(() => subscribeStats(setStats), [subscribeStats]);

  return (
    <HudGroup className="font-mono tabular-nums">
      {stats ? (
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">FPS</dt>
          <dd className="text-right font-semibold text-foreground">{fmt(stats.fps)}</dd>
          <dt className="text-muted-foreground">Splats rendus</dt>
          <dd className="text-right text-foreground">{fmt(stats.activeSplats)}</dd>
          <dt className="text-muted-foreground">Splats totaux</dt>
          <dd className="text-right text-foreground">{fmt(stats.totalSplats)}</dd>
          <dt className="text-muted-foreground">Draw calls</dt>
          <dd className="text-right text-foreground">{fmt(stats.calls)}</dd>
        </dl>
      ) : (
        <span className="text-muted-foreground">Mesure…</span>
      )}
    </HudGroup>
  );
}
