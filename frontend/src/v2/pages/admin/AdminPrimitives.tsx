// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import type { System } from './adminShared';
import { Card } from '../../components/ui/card';
import { Hint } from '../../components/ui/hint';
import { SettingsCard, type SettingsTone } from '../../components/settings/SettingsCard';
import { useT } from '../../i18n';

/** Petites primitives d'affichage partagées par les sections d'administration. */

export function Metric({
  label,
  value,
  sub,
  to,
}: {
  label: string;
  value: string | number;
  sub?: string;
  /** Si fourni, la carte devient cliquable et navigue vers les détails filtrés. */
  to?: string;
}) {
  const body = (
    <>
      <div className="text-2xl font-semibold">{value}</div>
      <Hint>{label}</Hint>
      {sub && <div className="mt-0.5 text-2xs text-primary">{sub}</div>}
    </>
  );
  if (to) {
    // `asChild` : la carte *est* le lien, sinon la zone cliquable se réduirait à son contenu.
    return (
      <Card asChild interactive className="block hover:bg-secondary/40">
        <Link to={to}>{body}</Link>
      </Card>
    );
  }
  return <Card>{body}</Card>;
}

/**
 * Le panneau de réglages de l'administration — désormais **la même carte** que celle des
 * réglages d'un projet et de ceux d'un profil.
 *
 * Il portait sa propre convention (titre en capitales grises), le profil la sienne (`h2`
 * semi-gras), et chaque section de projet recopiait la troisième. Trois dessins pour un
 * même objet, sur des écrans qu'on ouvre l'un après l'autre. `Panel` ne garde donc que sa
 * signature historique — un titre et un contenu — et délègue tout le reste.
 */
export function Panel({
  title,
  hint,
  icon,
  tone,
  footnote,
  actions,
  children,
}: {
  title: string;
  /** L'intention du panneau, en une ligne. */
  hint?: string;
  icon?: LucideIcon;
  tone?: SettingsTone;
  /** Note de bas de panneau, un cran plus petite. */
  footnote?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsCard title={title} hint={hint} icon={icon} tone={tone} footnote={footnote} actions={actions}>
      {children}
    </SettingsCard>
  );
}

export function DistList({ data }: { data: Record<string, number> }) {
  const t = useT();
  const entries = Object.entries(data);
  if (entries.length === 0) return <Hint>{t('common.noData')}</Hint>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Seuils de la jauge. Ils codaient trois couleurs en hexadécimal brut dans un attribut
 * `style` — hors des tokens du thème, et hors de portée de `check-color-tokens`, qui ne
 * lit que les classes utilitaires. Le rouge y valait le même rouge en thème clair et en
 * thème sombre, et une instance qui change d'accent gardait ces trois-là.
 */
const gaugeTone = (pct: number): string =>
  pct > 90 ? 'bg-destructive' : pct > 75 ? 'bg-warning' : 'bg-success';

export function Gauge({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        {/* Seule la largeur reste en `style` : elle est calculée, la couleur ne l'est pas. */}
        <div className={`h-full rounded-full ${gaugeTone(pct)}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ServiceHealth({ services }: { services: System['services'] }) {
  const t = useT();
  const items: [string, boolean][] = [
    ['PostgreSQL', services.database],
    ['Redis', services.redis],
    ['MinIO', services.minio],
  ];
  return (
    <div className="space-y-1.5">
      {items.map(([name, ok]) => (
        <div key={name} className="flex items-center justify-between text-sm">
          <span>{name}</span>
          <span className={`flex items-center gap-1.5 text-xs ${ok ? 'text-success' : 'text-destructive'}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-success' : 'bg-destructive'}`} />
            {ok ? 'OK' : t('admin.outOfService')}
          </span>
        </div>
      ))}
    </div>
  );
}
