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

/** Small display primitives shared by the administration sections. */

export function Metric({
  label,
  value,
  sub,
  to,
}: {
  label: string;
  value: string | number;
  sub?: string;
  /** If provided, the card becomes clickable and navigates to the filtered details. */
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
    // `asChild`: the card *is* the link, otherwise the clickable area would shrink to its content.
    return (
      <Card asChild interactive className="block hover:bg-secondary/40">
        <Link to={to}>{body}</Link>
      </Card>
    );
  }
  return <Card>{body}</Card>;
}

/**
 * The administration settings panel — now **the same card** as that of a
 * project's settings and a profile's.
 *
 * It carried its own convention (grey capitalised title), the profile its own (`h2`
 * semi-bold), and each project section copied the third. Three designs for one
 * same object, on screens opened one after the other. `Panel` therefore keeps only its
 * historical signature — a title and a content — and delegates everything else.
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
  /** The panel's purpose, in one line. */
  hint?: string;
  icon?: LucideIcon;
  tone?: SettingsTone;
  /** Footer note of the panel, one notch smaller. */
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
 * Gauge thresholds. They coded three colours as raw hexadecimal in a
 * `style` attribute — outside the theme tokens, and out of reach of `check-color-tokens`, which
 * only reads utility classes. Red was the same red in light and in
 * dark theme, and an instance changing its accent kept those three.
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
        {/* Only the width stays in `style`: it is computed, the colour is not. */}
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
