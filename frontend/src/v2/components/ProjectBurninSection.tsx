import type { BurninConfig } from '../types/share';

const FLAGS: { key: keyof BurninConfig & string; label: string }[] = [
  { key: 'enabled', label: 'Burn-ins sur les proxys (shot/version/TC)' },
  { key: 'showShot', label: 'Code du shot' },
  { key: 'showVersion', label: 'Nom de la version' },
  { key: 'showTimecode', label: 'Timecode' },
  { key: 'showLogo', label: 'Logo studio' },
  { key: 'slate', label: 'Slate en tête des partages client' },
];

/** Valeurs proposées quand on personnalise (l'override remplace le template champ par champ). */
const CUSTOM_DEFAULTS: Partial<BurninConfig> = {
  enabled: true,
  showShot: true,
  showVersion: true,
  showTimecode: true,
  showLogo: false,
  customText: '',
  slate: false,
};

/**
 * Section « Burn-ins » des réglages projet (35.A) : override du template studio.
 * Sans override, le projet hérite du template configuré dans Admin → Diffusion.
 */
export default function ProjectBurninSection({
  value,
  onChange,
}: {
  value: Partial<BurninConfig> | undefined;
  onChange: (v: Partial<BurninConfig> | undefined) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 text-sm font-medium">Burn-ins & slates</div>
      {!value ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Ce projet hérite du template studio (Admin → Diffusion).
          </p>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary/60"
            onClick={() => onChange({ ...CUSTOM_DEFAULTS })}
          >
            Personnaliser pour ce projet
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {FLAGS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={Boolean(value[f.key])}
                onChange={(e) => onChange({ ...value, [f.key]: e.target.checked })}
              />
              {f.label}
            </label>
          ))}
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Texte libre (bas gauche)</span>
            <input
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
              value={value.customText ?? ''}
              onChange={(e) => onChange({ ...value, customText: e.target.value })}
              placeholder="CONFIDENTIEL — ne pas diffuser"
              maxLength={120}
            />
          </label>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/60"
            onClick={() => onChange(undefined)}
          >
            Revenir au template studio
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Appliqué aux prochains transcodages (upload ou reprocess) — pas d'effet rétroactif.
      </p>
    </section>
  );
}
