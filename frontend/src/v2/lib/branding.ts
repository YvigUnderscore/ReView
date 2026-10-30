// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { contrastRatio, hexToRgb, type Rgb } from './contrast';

/**
 * Studio theme (42.B — №101): accent + logo + name, set by the admin and applied globally
 * (including the sign-in page). The accent (hex colour) overrides the `--primary`/`--ring` tokens;
 * cached in localStorage for an instant render (anti-flash).
 */
/**
 * Sign-in page styling (set in Admin → Sign-in page). Travels with the public branding: the page is
 * pre-auth, there is no other channel to obtain it.
 */
export interface LoginAppearance {
  layout: 'split' | 'centered';
  bgKey: string | null;
  /** Presigned URL of the background image, `null` if no image is configured. */
  bgUrl: string | null;
  bgFit: 'cover' | 'contain';
  /** Opacity of the veil laid over the image (0 → 0.95). */
  overlay: number;
  /** Blur of the image, in pixels (0 → 24). */
  blur: number;
  /** Custom tagline; empty string = default translated text. */
  tagline: string;
  showLogo: boolean;
}

export const DEFAULT_LOGIN_APPEARANCE: LoginAppearance = {
  layout: 'split',
  bgKey: null,
  bgUrl: null,
  bgFit: 'cover',
  overlay: 0.45,
  blur: 0,
  tagline: '',
  showLogo: true,
};

export interface Branding {
  name: string | null;
  /** Accent colour in hex "#RRGGBB" format (converted to HSL when applied). */
  accent: string | null;
  logoUrl: string | null;
  /**
   * Matching source code (AGPL §13), the `studio_source_url` setting validated server-side
   * (http/https only) and falling back to the upstream repository when it is not set.
   */
  sourceUrl: string;
  /** Missing from instances predating this setting: fall back to `DEFAULT_LOGIN_APPEARANCE`. */
  login?: LoginAppearance;
  /**
   * Studio setting `draftMode` (Phase 50): does the studio keep the two-step flow (upload, then
   * publish)? It travels with the branding because it is the only channel everyone can read —
   * admin settings are reserved for admins. Absent = off, i.e. publishing on upload. Read by `lib/draftMode`.
   */
  draftMode?: boolean;
}

const ACCENT_LS = 'review:accent';

/** "#RRGGBB" → "H S% L%" (format of the CSS tokens). `null` if the input is invalid. */
export function hexToHsl(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Applies the studio accent (hex) to the `--primary`/`--ring` tokens; `null` = default settings.
 *
 * `--primary-foreground` is derived from the accent's luminance (A2): the inline style wins over
 * `:root` as well as `.dark`, so a dark accent chosen by the admin left a `bg-primary text-primary-foreground`
 * unreadable in one of the two themes.
 */
export function applyAccent(hex: string | null): void {
  const root = document.documentElement;
  const hsl = hex ? hexToHsl(hex) : null;
  if (hsl) {
    const readable = readableAccent(hsl, root.classList.contains('dark'));
    root.style.setProperty('--primary', readable);
    root.style.setProperty('--ring', readable);
    root.style.setProperty('--primary-foreground', accentForeground(hex));
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--ring');
    root.style.removeProperty('--primary-foreground');
  }
}

/**
 * Lightness bounds of the accent, per theme.
 *
 * Measured on the demo instance: the accent `#1ec6dc` (L = 49%) was applied as-is in both themes.
 * On the light background (L = 97%) it only reached **1.93:1** — below the 3:1 required for a
 * non-text element. Two consequences: active links and tabs (`text-primary`) became unreadable,
 * and above all **the focus ring disappeared**, leaving a keyboard user with no landmark.
 *
 * `--primary` is also the button fill, but its ink (`--primary-foreground`) is already derived from
 * luminance: darkening the accent in light theme does not break the fills, and restores to the text
 * as well as the focus the contrast they lacked.
 *
 * 38% against the light background gives ≈ 3.3:1, 45% against the dark background ≈ 7:1. The default
 * tokens of `index.css` (24% in light, 50% in dark) stay within these bounds: this function only
 * corrects the accents chosen by an administrator.
 */
function readableAccent(hsl: string, isDark: boolean): string {
  const [h, s, l] = hsl.split(' ');
  const lightness = Number.parseFloat(l ?? '50');
  if (!Number.isFinite(lightness)) return hsl;
  const bounded = isDark ? Math.max(lightness, 45) : Math.min(lightness, 38);
  return `${h} ${s} ${bounded}%`;
}

/** Readable ink on an accent fill: white or dark ink, whichever has the stronger contrast. */
function accentForeground(hex: string | null): string {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return '0 0% 100%';
  const ink: Rgb = [0.02, 0.03, 0.05];
  const white: Rgb = [1, 1, 1];
  return contrastRatio(ink, rgb) >= contrastRatio(white, rgb) ? '220 29% 6%' : '0 0% 100%';
}

// Applies the cached accent as soon as the module is imported (before the first render / request).
try {
  applyAccent(localStorage.getItem(ACCENT_LS));
} catch {
  /* storage unavailable */
}

/** The studio's visual identity + accent application (shared by login and app). */
export function useBranding() {
  const q = useQuery({
    queryKey: qk.branding,
    queryFn: () => api.get<Branding>('/api/studio/branding'),
    staleTime: 5 * 60_000,
  });
  const accent = q.data?.accent ?? null;
  useEffect(() => {
    if (q.data === undefined) return;
    applyAccent(accent);
    try {
      if (accent) localStorage.setItem(ACCENT_LS, accent);
      else localStorage.removeItem(ACCENT_LS);
    } catch {
      /* storage unavailable */
    }
  }, [accent, q.data]);
  return q;
}
