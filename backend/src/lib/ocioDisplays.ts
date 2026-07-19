/**
 * Extraction des displays/views d'une config OCIO (39.B). Les fichiers `.ocio` sont du YAML avec
 * des tags custom (`!<View> {name: …}`) que les parseurs YAML standards gèrent mal ; on scanne donc
 * la section `displays:` ligne à ligne. Module **pur** (entrée = texte, sortie = structure).
 *
 * Format ciblé (configs ACES ASWF) :
 *   displays:
 *     sRGB - Display:
 *       - !<View> {name: ACES 1.0 - SDR Video, view_transform: …, display_colorspace: …}
 *       - !<View> {name: Raw, colorspace: Raw}
 */

export interface OcioDisplay {
  name: string;
  views: string[];
}

const MAX_DISPLAYS = 64;
const MAX_VIEWS = 64;
const VIEW_NAME_RE = /!<View>\s*\{[^}]*\bname:\s*([^,}]+)/;
const DISPLAY_HEADER_RE = /^\s{2}(?!-)(.+?):\s*$/;

/** Parse la section `displays:` d'un texte de config OCIO. Renvoie une liste vide si absente. */
export function parseOcioDisplays(text: string): OcioDisplay[] {
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex((l) => /^displays:\s*$/.test(l));
  if (i === -1) return [];
  const displays: OcioDisplay[] = [];
  let current: OcioDisplay | null = null;
  for (i++; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (/^\S/.test(line)) break; // clé de premier niveau suivante → fin de la section
    if (line.trim() === '') continue;
    const header = DISPLAY_HEADER_RE.exec(line);
    if (header?.[1]) {
      if (displays.length >= MAX_DISPLAYS) break;
      current = { name: header[1].trim(), views: [] };
      displays.push(current);
      continue;
    }
    const view = VIEW_NAME_RE.exec(line);
    if (view?.[1] && current && current.views.length < MAX_VIEWS) {
      current.views.push(view[1].trim());
    }
  }
  return displays.filter((d) => d.views.length > 0);
}

/** Vrai si le couple display/view existe dans la config parsée. */
export function isValidDisplayView(displays: OcioDisplay[], display: string, view: string): boolean {
  return displays.some((d) => d.name === display && d.views.includes(view));
}
