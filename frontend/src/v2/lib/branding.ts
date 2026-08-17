// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';

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

/** Applique l'accent studio (hex) sur les tokens `--primary`/`--ring` ; `null` = réglages par défaut. */
export function applyAccent(hex: string | null): void {
  const root = document.documentElement;
  const hsl = hex ? hexToHsl(hex) : null;
  if (hsl) {
    root.style.setProperty('--primary', hsl);
    root.style.setProperty('--ring', hsl);
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--ring');
  }
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
