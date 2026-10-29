// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseIdParam } from './slug';

/**
 * Canonicalises the id segment of the URL to its slugged form as soon as the name is loaded.
 * Guarantees a readable address even when the clicked link only carried an id
 * (`/review/219` → `/review/perso-principal-v01-219`). Replaces **in place** (no history
 * entry), and only if the raw segment and the target resolve to the **same** id
 * (guard against cross-redirection). `canonical = null` while the name is unknown.
 */
export function useCanonicalSlug(rawParam: string | null | undefined, canonical: string | null): void {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!rawParam || !canonical || rawParam === canonical) return;
    if (parseIdParam(rawParam) !== parseIdParam(canonical)) return;
    const escaped = rawParam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pathname = location.pathname.replace(new RegExp(`(^|/)${escaped}(?=/|$)`), `$1${canonical}`);
    if (pathname !== location.pathname) {
      void navigate({ pathname, search: location.search, hash: location.hash }, { replace: true });
    }
  }, [rawParam, canonical, location, navigate]);
}
