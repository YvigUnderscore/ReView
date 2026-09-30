// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext, useId, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardDescription, CardTitle } from '../ui/card';

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
    <Card className="space-y-3">
      <header className="flex items-start gap-2">
        <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <CardTitle>{title}</CardTitle>
          {hint && <CardDescription className="mt-0.5">{hint}</CardDescription>}
        </div>
        {busy && <Loader2 className="mt-0.5 shrink-0 animate-spin text-muted-foreground" size={13} />}
      </header>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

/**
 * Le libellé d'une ligne nomme le contrôle qu'elle porte.
 *
 * Il était rendu dans un `<div>` : la ligne se lit à l'écran, mais rien ne rattachait le
 * texte au contrôle — le lecteur d'écran annonçait « liste déroulante » et rien d'autre,
 * dix fois de suite, sur une page où c'est justement le libellé qui distingue un réglage
 * du suivant. La ligne fabrique donc l'identifiant, le transmet au contrôle qu'elle
 * englobe et le désigne par un vrai `<label htmlFor>`.
 */
const RowFieldId = createContext<string | undefined>(undefined);

/** Une ligne « libellé + contrôle », le contrôle aligné à droite. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <RowFieldId.Provider value={id}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={id} className="block text-sm">
            {label}
          </label>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </RowFieldId.Provider>
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
  const id = useContext(RowFieldId);
  return (
    <select
      id={id}
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
  const id = useContext(RowFieldId);
  return (
    <input
      type="number"
      id={id}
      min={min}
      max={max}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      /*
       * Dans une `Row`, c'est le libellé de la ligne qui nomme le champ — « Taille
       * maximale » plutôt que « Sans limite », le placeholder n'étant qu'un exemple de
       * valeur. Hors d'une ligne, il reste le seul nom disponible.
       */
      aria-label={id ? undefined : placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} rounded-md border border-border bg-background px-2 py-1 text-sm`}
    />
  );
}
