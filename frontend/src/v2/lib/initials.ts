/** Initiales à partir d'un nom (repli pour les avatars). Pur, testable. */
export function initialsFrom(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase() || '?';
}
