/**
 * Changelog in-app (42.B — №68) : parse le markdown `DOCUMENTATION/CHANGELOG.md`
 * (servi sur /docs/CHANGELOG.md) en entrées, une par titre de niveau 2 (`## …`),
 * la plus récente en premier. Le corps reste du markdown (rendu via docsRender).
 */
export interface ChangelogEntry {
  /** Titre de l'entrée (= identifiant, ex. « 2026-07 — … »). */
  id: string;
  body: string;
}

export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const line of md.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) entries.push(current);
      current = { id: m[1]!.trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) entries.push(current);
  return entries.map((e) => ({ id: e.id, body: e.body.trim() }));
}
