// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { h } from '../lib/dom.js';

/**
 * Écran de choix du mode (spécification, « Le choix du mode est explicite »).
 *
 * Chaque carte répond aux trois mêmes questions, dans le même ordre : ce qui atterrit sur le
 * disque, ce qui sort de la machine, ce qui se passe à la fermeture. Aucune n'est
 * présélectionnée — le choix doit être un acte. En 0.2, seul le mode serveur est livré :
 * les deux autres gardent leurs mots, mais s'annoncent pour une mise à jour à venir plutôt
 * que de promettre ce que l'application ne fait pas encore.
 */
const MODES = [
  { id: 'local', key: 'mode.local', main: true, available: false },
  { id: 'join', key: 'mode.join', main: false, available: false },
  { id: 'server', key: 'mode.server', main: false, available: true, strongDisk: true },
];

/** L'accent va au cas le plus courant s'il est disponible, sinon au premier qui l'est. */
const ACCENT = (MODES.find((m) => m.main && m.available) ?? MODES.find((m) => m.available))?.id;

export function renderMode(ctx) {
  const card = (mode) => {
    const facts = h(
      'dl',
      { class: 'card-facts' },
      h(
        'div',
        {},
        h('dt', {}, ctx.t('mode.disk')),
        h('dd', { class: mode.strongDisk ? 'is-strong' : null }, ctx.t(`${mode.key}.disk`)),
      ),
      h('div', {}, h('dt', {}, ctx.t('mode.shared')), h('dd', {}, ctx.t(`${mode.key}.shared`))),
      h('div', {}, h('dt', {}, ctx.t('mode.close')), h('dd', {}, ctx.t(`${mode.key}.close`))),
    );
    const choose = () => {
      if (mode.available) ctx.go('connect');
    };
    // Quatre enfants directs, toujours : la grille parente les aligne d'une carte à l'autre
    // (filet sous la description à la même hauteur partout, comme sur la maquette). Une
    // carte disponible garde donc une case vide à la place de l'annonce « bientôt ».
    // L'accent ne va qu'à une carte que l'on peut choisir (`ACCENT`) : posé sur une carte
    // inactive, il se lirait comme une présélection.
    return h(
      'button',
      {
        type: 'button',
        class: `card${mode.id === ACCENT ? ' is-main' : ''}`,
        'data-mode': mode.id,
        'aria-disabled': mode.available ? null : 'true',
        onClick: choose,
      },
      mode.available
        ? h('span', { class: 'soon-slot', 'aria-hidden': 'true' })
        : h('span', { class: 'soon' }, ctx.t('mode.soon')),
      h('span', { class: 'card-title' }, ctx.t(`${mode.key}.title`)),
      h('span', { class: 'card-desc' }, ctx.t(`${mode.key}.desc`)),
      facts,
    );
  };

  return h(
    'section',
    { 'aria-labelledby': 'mode-heading' },
    h('h1', { id: 'mode-heading' }, ctx.t('mode.heading')),
    h('p', { class: 'lead' }, ctx.t('mode.subheading')),
    h('div', { class: 'cards' }, MODES.map(card)),
    h(
      'p',
      { class: 'note' },
      ctx.t('mode.serverInstall'),
      ' ',
      h(
        'button',
        { type: 'button', class: 'link', onClick: () => ctx.api.openLink('server_install') },
        ctx.t('mode.serverInstallLink'),
      ),
    ),
  );
}
