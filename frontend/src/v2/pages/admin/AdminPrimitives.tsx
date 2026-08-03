// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { System } from './adminShared';
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
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-primary">{sub}</div>}
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary hover:bg-secondary/40"
      >
        {body}
      </Link>
    );
  }
  return <div className="rounded-lg border border-border bg-card p-4">{body}</div>;
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export function DistList({ data }: { data: Record<string, number> }) {
  const t = useT();
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">{t('common.noData')}</p>;
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

export function Gauge({ label, pct }: { label: string; pct: number }) {
  const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#22c55e';
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
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
