export type ProjectsTab = 'active' | 'archived';

/** Bascule Actifs / Archivés de la page Projets (38.B, réservée aux gestionnaires). */
export default function ProjectsTabs({
  tab,
  onChange,
}: {
  tab: ProjectsTab;
  onChange: (t: ProjectsTab) => void;
}) {
  const cls = (active: boolean) =>
    `rounded px-2.5 py-1 ${active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`;
  return (
    <div className="flex rounded-md border border-border p-0.5 text-sm">
      <button type="button" onClick={() => onChange('active')} className={cls(tab === 'active')}>
        Actifs
      </button>
      <button type="button" onClick={() => onChange('archived')} className={cls(tab === 'archived')}>
        Archivés
      </button>
    </div>
  );
}
