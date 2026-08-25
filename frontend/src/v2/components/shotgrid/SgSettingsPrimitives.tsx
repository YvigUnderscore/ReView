// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Les briques des réglages ShotGrid.
 *
 * Le panneau empilait sept `<section>` nues dans un seul flux : rien ne disait où finissait
 * « médias » et où commençait « écritures », et il fallait lire tous les libellés pour
 * retrouver un réglage. Une carte par thème, avec son titre et sa phrase d'intention,
 * rend la page parcourable — c'est ce qui distingue une liste d'options d'un écran.
 */

export function SettingsCard({
  icon: Icon,
  title,
  hint,
  busy,
  children,
}: {
  icon: typeof Loader2;
  title: string;
  /** Une phrase : à quoi sert ce groupe. Pas la répétition des libellés qui suivent. */
  hint?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <header className="flex items-start gap-2">
        <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {busy && <Loader2 className="mt-0.5 shrink-0 animate-spin text-muted-foreground" size={13} />}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Une ligne « libellé + contrôle », le contrôle aligné à droite. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 shrink-0"
      />
    </label>
  );
}

/** Sélecteur au format des réglages — même dimension partout, sans quoi la colonne danse. */
export function SettingSelect({
  value,
  disabled,
  onChange,
  children,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
    >
      {children}
    </select>
  );
}

/** Champ numérique borné — même style que le sélecteur. */
export function SettingNumber({
  value,
  min,
  max,
  disabled,
  placeholder,
  width = 'w-24',
  onChange,
}: {
  value: number | '' | null;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  width?: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} rounded-md border border-border bg-background px-2 py-1 text-sm`}
    />
  );
}
