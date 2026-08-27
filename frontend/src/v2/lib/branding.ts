// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { contrastRatio, hexToRgb, type Rgb } from './contrast';

/**
 * Thème studio (42.B — №101) : accent + logo + nom, définis par l'admin et appliqués
 * globalement (y compris la page de connexion). L'accent (couleur hex) surcharge les tokens
 * `--primary`/`--ring` ; mis en cache localStorage pour un rendu instantané (anti-flash).
 */
/**
 * Habillage de la page de connexion (réglé dans Admin → Page de connexion). Voyage avec le
 * branding public : la page est pré-auth, il n'y a pas d'autre canal pour l'obtenir.
 */
export interface LoginAppearance {
  layout: 'split' | 'centered';
  bgKey: string | null;
  /** URL présignée de l'image de fond, `null` si aucune image n'est configurée. */
  bgUrl: string | null;
  bgFit: 'cover' | 'contain';
  /** Opacité du voile posé sur l'image (0 → 0.95). */
  overlay: number;
  /** Flou de l'image, en pixels (0 → 24). */
  blur: number;
  /** Accroche personnalisée ; chaîne vide = texte traduit par défaut. */
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
  /** Couleur d'accent au format hex « #RRGGBB » (convertie en HSL à l'application). */
  accent: string | null;
  logoUrl: string | null;
  /**
   * Code source correspondant (AGPL §13), réglage `studio_source_url` validé côté serveur
   * (http/https uniquement) et replié sur le dépôt amont s'il n'est pas renseigné.
   */
  sourceUrl: string;
  /** Absent des instances antérieures à ce réglage : replier sur `DEFAULT_LOGIN_APPEARANCE`. */
  login?: LoginAppearance;
}

const ACCENT_LS = 'review:accent';

/** « #RRGGBB » → « H S% L% » (format des tokens CSS). `null` si l'entrée est invalide. */
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
 * Applique l'accent studio (hex) sur les tokens `--primary`/`--ring` ; `null` = réglages
 * par défaut.
 *
 * `--primary-foreground` est dérivé de la luminance de l'accent (A2) : le style inline
 * l'emporte sur `:root` comme sur `.dark`, donc un accent sombre choisi par l'admin
 * laissait un `bg-primary text-primary-foreground` illisible dans l'un des deux thèmes.
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
 * Bornes de luminosité de l'accent, par thème.
 *
 * Mesuré sur l'instance de démonstration : l'accent `#1ec6dc` (L = 49 %) était appliqué tel
 * quel dans les deux thèmes. Sur le fond clair (L = 97 %) il ne tenait que **1,93:1** —
 * en dessous des 3:1 exigés pour un élément non textuel. Deux conséquences : les liens et
 * onglets actifs (`text-primary`) devenaient illisibles, et surtout **l'anneau de focus
 * disparaissait**, ce qui laisse un utilisateur au clavier sans repère.
 *
 * `--primary` sert aussi d'aplat de bouton, mais son encre (`--primary-foreground`) est déjà
 * dérivée de la luminance : assombrir l'accent en thème clair ne casse pas les aplats, et
 * rend au texte comme au focus le contraste qui leur manquait.
 *
 * 38 % contre le fond clair donne ≈ 3,3:1, 45 % contre le fond sombre ≈ 7:1. Les tokens par
 * défaut d'`index.css` (24 % en clair, 50 % en sombre) restent dans ces bornes : cette
 * fonction ne corrige que les accents choisis par un administrateur.
 */
function readableAccent(hsl: string, isDark: boolean): string {
  const [h, s, l] = hsl.split(' ');
  const lightness = Number.parseFloat(l ?? '50');
  if (!Number.isFinite(lightness)) return hsl;
  const bounded = isDark ? Math.max(lightness, 45) : Math.min(lightness, 38);
  return `${h} ${s} ${bounded}%`;
}

/** Encre lisible sur un aplat d'accent : blanc ou encre sombre, selon le plus contrasté. */
function accentForeground(hex: string | null): string {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return '0 0% 100%';
  const ink: Rgb = [0.02, 0.03, 0.05];
  const white: Rgb = [1, 1, 1];
  return contrastRatio(ink, rgb) >= contrastRatio(white, rgb) ? '220 29% 6%' : '0 0% 100%';
}

// Applique l'accent en cache dès l'import (avant le premier rendu / requête).
try {
  applyAccent(localStorage.getItem(ACCENT_LS));
} catch {
  /* stockage indisponible */
}

/** Identité visuelle du studio + application de l'accent (partagé login/app). */
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
      /* stockage indisponible */
    }
  }, [accent, q.data]);
  return q;
}
