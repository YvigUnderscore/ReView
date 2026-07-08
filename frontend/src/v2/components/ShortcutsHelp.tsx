import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

/**
 * Panneau récapitulatif des raccourcis clavier (10.A3), ouvert avec `?`.
 */

const GROUPS: { title: string; shortcuts: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Ctrl', 'K'], label: 'Recherche globale (palette de commandes)' },
      { keys: ['G', 'P'], label: 'Aller aux projets' },
      { keys: ['G', 'K'], label: 'Kanban du projet courant' },
      { keys: ['G', 'B'], label: 'Board du projet courant' },
    ],
  },
  {
    title: 'Review vidéo',
    shortcuts: [
      { keys: ['Espace'], label: 'Lecture / pause' },
      { keys: ['←', '→'], label: '± 1 frame' },
      { keys: ['Maj', '←/→'], label: '± 10 frames' },
      { keys: ['J'], label: 'Lecture arrière (répéter : ×2, ×4, ×8)' },
      { keys: ['K'], label: 'Pause' },
      { keys: ['L'], label: 'Lecture avant (répéter : ×2, ×4, ×8)' },
      { keys: ['M'], label: 'Commenter à la frame courante' },
    ],
  },
  {
    title: 'Review splat',
    shortcuts: [
      {
        keys: ['Clic droit', 'ZQSD'],
        label: 'Vol type Unreal — A/E : descendre/monter, molette : vitesse, Maj : accélérer',
      },
      { keys: ['T', 'R', 'S'], label: 'Gizmos déplacer / tourner / échelle (éditeur)' },
      { keys: ['B', 'L'], label: 'Sélection rectangle / lasso (Maj ajoute, Alt retire)' },
      { keys: ['F'], label: 'Cadrer la sélection (ou tout le splat)' },
      { keys: ['H'], label: "Vue d'origine" },
      { keys: ['Suppr'], label: 'Supprimer la sélection (non-destructif)' },
      { keys: ['Ctrl', 'Z / Y'], label: 'Annuler / rétablir' },
    ],
  },
  {
    title: 'Aide',
    shortcuts: [{ keys: ['?'], label: 'Afficher ce panneau' }],
  },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

export default function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
              </p>
              <ul className="space-y-1.5">
                {g.shortcuts.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">{s.label}</span>
                    <Keys keys={s.keys} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
