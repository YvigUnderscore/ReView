// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { env } from '../config/env';
import { t, type Locale } from '../i18n';
import { preheader } from './mailText';

/**
 * Enveloppe HTML de marque commune à tous les emails ReView (Phase 22) — DA cohérente
 * (thème bleu nuit, accent cyan). Les clients mail ne supportant pas les variables CSS,
 * les couleurs du thème sont figées ici en dur : elles reprennent désormais à l'identique
 * la palette de référence du mode sombre (`frontend/src/index.css`), et non plus des
 * approximations Tailwind qui donnaient à nos mails l'allure d'une autre application.
 * L'ancien bandeau en dégradé cyan→magenta est retiré : un aplat de marque, un logo.
 */

/** Accent de marque (cyan `--primary` du mode sombre) — liens et boutons. */
export const MAIL_ACCENT = '#00F0FF';
/** Filets et séparateurs internes au corps du message (`--border`). */
export const MAIL_BORDER = '#1E2433';
/** Texte secondaire du corps (`--muted-foreground`) — jamais un gris arbitraire. */
export const MAIL_MUTED = '#9BA3B2';

const BG = '#0B0E14'; // --background
const CARD = '#121620'; // --card
const BORDER = MAIL_BORDER;
const TEXT = '#E6EBEF'; // --foreground
const MUTED = MAIL_MUTED;
const TITLE = '#F4F7F9';

/**
 * En-tête : le logo du site quand l'instance a une URL publique (les images distantes ne
 * peuvent pas être servies depuis un chemin relatif dans un email), sinon le nom en toutes
 * lettres. `alt` porte la marque de toute façon — beaucoup de clients bloquent les images.
 */
function brandHeader(): string {
  const logo = env.APP_URL ? `${env.APP_URL}/logo_banner.png` : null;
  return logo
    ? `<img src="${logo}" alt="ReView" width="112" style="display:block;border:0;height:auto;width:112px" />`
    : `<span style="font-weight:500;color:${TEXT};font-size:16px;letter-spacing:0.06em">ReView</span>`;
}

/**
 * Bouton d'action principal. Les clients mail ignorent `<button>` et la plupart des
 * feuilles de style : c'est un lien à fond plein, tout en styles inline.
 */
export function mailButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px auto"><tr><td align="center" bgcolor="${MAIL_ACCENT}" style="background:${MAIL_ACCENT};border-radius:8px">
<a href="${url}" style="display:inline-block;padding:12px 28px;color:${BG};font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;font-weight:600;text-decoration:none">${label}</a>
</td></tr></table>`;
}

/**
 * Emballe un contenu HTML dans l'enveloppe de marque (en-tête logo + pied).
 *
 * Le pied est traduit dans la langue du destinataire — un email qui s'ouvre dans une
 * langue et se signe dans une autre sonne faux.
 *
 * La mise en page est en `<table>`, pas en `<div>` : Outlook pour Windows rend le HTML
 * avec le moteur de Word, qui ignore `border-radius`, gère mal `padding` sur un bloc et
 * ne connaît pas `max-width`. Nos messages y arrivaient étalés sur toute la largeur,
 * sans cadre. Le `preheader` s'insère en tête du corps : c'est le texte que la liste des
 * messages affiche avant l'ouverture, et sans lui elle répète le nom du studio.
 */
export function mailLayout(locale: Locale, title: string, contentHtml: string, preview?: string): string {
  return `<div lang="${locale}" style="font-family:ui-sans-serif,system-ui,sans-serif;background:${BG};padding:24px">
${preview ? preheader(preview) : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG}">
    <tr>
      <td align="center" style="padding:0">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:${CARD};border:1px solid ${BORDER};border-radius:12px;color:${TEXT}">
          <tr>
            <td style="padding:16px 20px;border-bottom:1px solid ${BORDER}">
              ${brandHeader()}
            </td>
          </tr>
          <tr>
            <td style="padding:20px;font-size:14px;line-height:1.7;color:${TEXT}">
              <h1 style="font-size:18px;font-weight:600;margin:0 0 12px;color:${TITLE}">${title}</h1>
              ${contentHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:12px 20px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px">
              ${t(locale, 'mail.footer')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}
