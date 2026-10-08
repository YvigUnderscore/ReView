// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { h } from '../lib/dom.js';

/**
 * Pied permanent : version, diagnostic du webview, licences tierces, et le lien vers le
 * code source — l'AGPL demande de l'offrir à quiconque utilise le programme.
 */
export function renderFooter(ctx) {
  const link = (label, onClick) => h('button', { type: 'button', class: 'link', onClick }, label);
  return [
    h('span', {}, ctx.t('footer.version', { version: ctx.info.version })),
    h('span', { class: 'spacer' }),
    link(ctx.t('footer.diagnostic'), () => ctx.api.openDiagnostic(ctx.t('window.diagnosticTitle'))),
    link(ctx.t('footer.notices'), () => ctx.api.openNotices(ctx.t('window.noticesTitle'))),
    link(ctx.t('footer.guide'), () => ctx.api.openLink('desktop_guide')),
    link(ctx.t('footer.source'), () => ctx.api.openLink('source')),
  ];
}
