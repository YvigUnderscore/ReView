export type CreateMode = 'simple' | 'manual' | 'auto';

/** Sélecteur de mode de création (simple / lot manuel / génération auto). */
export default function ModeSwitch({ mode, setMode }: { mode: CreateMode; setMode: (m: CreateMode) => void }) {
  const opts: { key: CreateMode; label: string }[] = [
    { key: 'simple', label: 'Simple' },
    { key: 'manual', label: 'Lot' },
    { key: 'auto', label: 'Auto' },
  ];
  return (
    <div className="flex overflow-hidden rounded-md border border-border text-xs">
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => setMode(o.key)}
          className={`px-2.5 py-1 ${mode === o.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
