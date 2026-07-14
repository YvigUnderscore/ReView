/**
 * Enveloppe HTML de marque commune à tous les emails ReView (Phase 22) — DA cohérente
 * (thème bleu nuit + accent cyan/magenta). Les clients mail ne supportant pas les variables
 * CSS, les couleurs du thème sont figées ici en dur (miroir des tokens front).
 */

/** Accent de marque (cyan) — utilisé pour les liens dans le corps des emails. */
export const MAIL_ACCENT = '#22d3ee';

const BG = '#0b1120';
const CARD = '#111827';
const BORDER = '#1f2937';
const TEXT = '#e5e7eb';
const MUTED = '#6b7280';

/** Emballe un contenu HTML dans l'enveloppe de marque (en-tête dégradé + pied). */
export function mailLayout(title: string, contentHtml: string): string {
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;background:${BG};padding:24px">
  <div style="max-width:640px;margin:0 auto;background:${CARD};border:1px solid ${BORDER};border-radius:12px;overflow:hidden;color:${TEXT}">
    <div style="background:linear-gradient(90deg,#22d3ee,#d946ef);padding:14px 20px">
      <span style="font-weight:700;color:${BG};font-size:16px;letter-spacing:0.02em">ReView</span>
    </div>
    <div style="padding:20px">
      <h1 style="font-size:18px;margin:0 0 12px;color:#f9fafb">${title}</h1>
      ${contentHtml}
    </div>
    <div style="padding:12px 20px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px">
      ReView — plateforme de review collaborative
    </div>
  </div>
</div>`;
}
