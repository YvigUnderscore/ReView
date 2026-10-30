// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext, useId, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardDescription, CardTitle } from '../ui/card';

/**
 * Building blocks for the ShotGrid settings.
 *
 * The panel stacked seven bare `<section>` elements in a single flow: nothing said where
 * "media" ended and "writes" began, and finding a setting meant reading every label. One
 * card per theme, with its title and intent sentence, makes the page scannable: that is
 * what separates a list of options from a screen.
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
  /** One sentence: what this group is for. Not a repeat of the labels that follow. */
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
 * A row label names the control it carries.
 *
 * It was rendered in a `<div>`: the row reads on screen, but nothing tied the text to the
 * control. The screen reader announced "dropdown" and nothing else, ten times in a row, on
 * a page where the label is precisely what tells one setting from the next. The row
 * therefore generates the id, passes it to the control it wraps, and points to it with a
 * real `<label htmlFor>`.
 */
const RowFieldId = createContext<string | undefined>(undefined);

/** A "label + control" row, with the control aligned to the right. */
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

/** Select in the settings format: same size everywhere, otherwise the column jumps. */
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

/** Bounded numeric field, same style as the select. */
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
       * Inside a `Row`, the row's label names the field: "Max size" rather than
       * "No limit", since the placeholder is only an example value. Outside a row it
       * remains the only available name.
       */
      aria-label={id ? undefined : placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} rounded-md border border-border bg-background px-2 py-1 text-sm`}
    />
  );
}
