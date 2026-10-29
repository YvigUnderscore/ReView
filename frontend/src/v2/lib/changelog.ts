// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * In-app changelog (42.B — №68): parses the markdown `DOCUMENTATION/CHANGELOG.md`
 * (served at /docs/CHANGELOG.md) into entries, one per level-2 heading (`## …`),
 * most recent first. The body stays markdown (rendered via docsRender).
 */
export interface ChangelogEntry {
  /** Entry title (= identifier, e.g. "2026-07 — …"). */
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
      current = { id: m[1].trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) entries.push(current);
  return entries.map((e) => ({ id: e.id, body: e.body.trim() }));
}
