import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseIdParam } from './slug';

/**
 * Canonicalise le segment d'id de l'URL vers sa forme sluggée dès que le nom est chargé.
 * Garantit une adresse parlante même quand le lien cliqué ne portait qu'un id
 * (`/review/219` → `/review/perso-principal-v01-219`). Remplace **en place** (pas d'entrée
 * d'historique), et seulement si le segment brut et la cible résolvent le **même** id
 * (garde-fou anti-redirection croisée). `canonical = null` tant que le nom est inconnu.
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
      navigate({ pathname, search: location.search, hash: location.hash }, { replace: true });
    }
  }, [rawParam, canonical, location, navigate]);
}
