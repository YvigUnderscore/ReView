// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Plus, Trash2, Rows3 } from 'lucide-react';
import { useT } from '../i18n';

export interface RowField {
  key: string;
  placeholder: string;
  /** Largeur Tailwind (ex: 'w-24', 'flex-1'). Défaut: flex-1 */
  className?: string;
  /** Si fourni, rend un <select> au lieu d'un input */
  options?: { value: string; label: string }[];
}

/**
 * Saisie multi-lignes interactive pour créer plusieurs entités d'un coup
 * (séquences, shots…). Chaque ligne = un objet clé→valeur. On ajoute/retire
 * des lignes puis on valide tout le lot. Réutilisable et indépendant du domaine.
 */
export default function MultiRowCreate({
  fields,
  addLabel,
  onSubmit,
}: {
  fields: RowField[];
  addLabel: string;
  onSubmit: (rows: Record<string, string>[]) => Promise<void>;
}) {
  const t = useT();
  const emptyRow = () => Object.fromEntries(fields.map((f) => [f.key, f.options?.[0]?.value ?? '']));
  const [rows, setRows] = useState<Record<string, string>[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, key: string, value: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const submit = async () => {
    // Garde les lignes dont au moins le premier champ est rempli
    const filled = rows.filter((r) => (r[fields[0].key] ?? '').trim().length > 0);
    if (filled.length === 0) {
      setError(t('multirow.atLeastOne'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(filled);
      setRows([emptyRow(), emptyRow(), emptyRow()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Rows3 size={14} /> {t('batch.title')}
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            {fields.map((f) =>
              f.options ? (
                <select
                  key={f.key}
                  className={`rounded border border-input bg-background px-2 py-1.5 text-xs ${f.className ?? 'flex-1'}`}
                  value={row[f.key]}
                  onChange={(e) => update(i, f.key, e.target.value)}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  key={f.key}
                  className={`rounded border border-input bg-background px-2 py-1.5 text-xs ${f.className ?? 'flex-1'}`}
                  placeholder={f.placeholder}
                  value={row[f.key]}
                  onChange={(e) => update(i, f.key, e.target.value)}
                />
              ),
            )}
            <button
              type="button"
              onClick={() => removeRow(i)}
              title={t('multiRow.removeRow')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-destructive"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:bg-secondary/60"
        >
          <Plus size={14} /> {t('common.line')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
        >
          {busy ? t('setup.submitting') : addLabel}
        </button>
      </div>
    </div>
  );
}
