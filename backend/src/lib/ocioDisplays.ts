// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Extraction of the displays/views of an OCIO config (39.B). The `.ocio` files are YAML with custom tags
 * (`!<View> {name: …}`) that standard YAML parsers handle poorly; so we scan the `displays:` section line by line.
 * **Pure** module (input = text, output = structure).
 *
 * Targeted format (ASWF ACES configs):
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

/** Parses the `displays:` section of an OCIO config text. Returns an empty list if absent. */
export function parseOcioDisplays(text: string): OcioDisplay[] {
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex((l) => /^displays:\s*$/.test(l));
  if (i === -1) return [];
  const displays: OcioDisplay[] = [];
  let current: OcioDisplay | null = null;
  for (i++; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (/^\S/.test(line)) break; // next top-level key → end of the section
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

/** True if the display/view pair exists in the parsed config. */
export function isValidDisplayView(displays: OcioDisplay[], display: string, view: string): boolean {
  return displays.some((d) => d.name === display && d.views.includes(view));
}
