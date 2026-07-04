import { useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';

export interface GeneratedItem {
  code: string;
  name: string;
  sequenceId?: number | null;
}

/**
 * Générateur de codes en lot, semi-automatisé.
 * Ex : préfixe « SH » + départ 10 + pas 10 + 3 chiffres + 4 éléments → SH010 SH020 SH030 SH040.
 * Pour les shots, une destination (séquence) peut être choisie.
 */
export default function BatchGenerator({
  defaults,
  sequences,
  onSubmit,
}: {
  defaults: { prefix: string; step: number; padding: number };
  /** Si fourni → mode shots avec sélection de la séquence de destination. */
  sequences?: { id: number; code: string; name: string }[];
  onSubmit: (items: GeneratedItem[]) => Promise<void>;
}) {
  const [prefix, setPrefix] = useState(defaults.prefix);
  const [start, setStart] = useState(defaults.step);
  const [step, setStep] = useState(defaults.step);
  const [padding, setPadding] = useState(defaults.padding);
  const [count, setCount] = useState(4);
  const [sequenceId, setSequenceId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo<GeneratedItem[]>(() => {
    const n = Math.min(Math.max(count, 0), 200);
    return Array.from({ length: n }, (_, i) => {
      const num = start + i * step;
      const code = `${prefix}${String(num).padStart(padding, '0')}`;
      return {
        code,
        name: code,
        sequenceId: sequences ? (sequenceId ? Number(sequenceId) : null) : undefined,
      };
    });
  }, [prefix, start, step, padding, count, sequenceId, sequences]);

  const submit = async () => {
    if (items.length === 0) {
      setError('Aucun élément à générer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Wand2 size={14} /> Génération automatique
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Préfixe">
          <input
            className="w-20 rounded border border-input bg-background px-2 py-1.5 text-xs"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </Field>
        <Field label="Départ">
          <input
            type="number"
            className="w-20 rounded border border-input bg-background px-2 py-1.5 text-xs"
            value={start}
            onChange={(e) => setStart(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Pas">
          <input
            type="number"
            min={1}
            className="w-16 rounded border border-input bg-background px-2 py-1.5 text-xs"
            value={step}
            onChange={(e) => setStep(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
        <Field label="Chiffres">
          <input
            type="number"
            min={1}
            max={8}
            className="w-16 rounded border border-input bg-background px-2 py-1.5 text-xs"
            value={padding}
            onChange={(e) => setPadding(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
          />
        </Field>
        <Field label="Nombre">
          <input
            type="number"
            min={1}
            max={200}
            className="w-16 rounded border border-input bg-background px-2 py-1.5 text-xs"
            value={count}
            onChange={(e) => setCount(Math.min(200, Math.max(0, Number(e.target.value) || 0)))}
          />
        </Field>
        {sequences && (
          <Field label="Destination">
            <select
              className="w-44 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={sequenceId}
              onChange={(e) => setSequenceId(e.target.value)}
            >
              <option value="">Sans séquence</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {/* Aperçu des codes générés */}
      <div className="mt-3 flex flex-wrap gap-1">
        {items.slice(0, 30).map((it, i) => (
          <span key={i} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
            {it.code}
          </span>
        ))}
        {items.length > 30 && (
          <span className="px-1 text-[11px] text-muted-foreground">+{items.length - 30}…</span>
        )}
      </div>
      <button
        onClick={submit}
        disabled={busy}
        className="mt-3 flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'Création…' : `Créer ${items.length} élément(s)`}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
