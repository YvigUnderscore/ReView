import { toast } from 'sonner';

/**
 * Avertit avant d'écraser une animation caméra existante (Phase 27) : toast non bloquant avec
 * action « Remplacer ». Utilisé par les presets (orbite) qui remplacent toutes les clés.
 */
export function confirmReplaceAnim(onConfirm: () => void): void {
  toast('Remplacer l’animation caméra existante ?', {
    description: 'Le preset écrase les clés actuelles.',
    action: { label: 'Remplacer', onClick: onConfirm },
  });
}
