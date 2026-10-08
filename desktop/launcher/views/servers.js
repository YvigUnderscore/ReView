// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { h } from '../lib/dom.js';
import { errorMessage } from './connect.js';

/**
 * Serveurs connus. Chaque ligne porte son mode en clair (« rien sur ce disque ») : le badge
 * permanent de la spécification, ici dans le lanceur, et dans le titre de chaque fenêtre.
 * Retirer demande une confirmation sur place — pas de boîte de dialogue en plus.
 */
export function renderServers(ctx, servers) {
  const list = h('ul', { class: 'servers' });
  const status = h('div', { class: 'status', role: 'status' });

  for (const server of servers) {
    const open = h('button', { type: 'button', class: 'button primary' }, ctx.t('servers.open'));
    const remove = h('button', { type: 'button', class: 'button ghost' }, ctx.t('servers.remove'));
    let armed = false;

    open.addEventListener('click', async () => {
      open.disabled = true;
      status.className = 'status';
      status.textContent = ctx.t('connect.checking', { host: server.host });
      try {
        await ctx.api.connect(server.origin, ctx.t('window.serverBadge'));
        status.textContent = '';
      } catch (error) {
        status.className = 'status is-error';
        status.textContent = errorMessage(ctx.t, error);
      } finally {
        open.disabled = false;
      }
    });
    remove.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        remove.className = 'button danger';
        remove.textContent = ctx.t('servers.removeConfirm');
        return;
      }
      await ctx.api.removeServer(server.origin);
      ctx.go('servers');
    });

    list.append(
      h(
        'li',
        { class: 'server', 'data-origin': server.origin },
        h(
          'div',
          { class: 'server-main' },
          h(
            'div',
            { class: 'server-name' },
            server.studioName ?? server.host,
            h('span', { class: 'badge' }, ctx.t('servers.badge')),
            server.secure ? null : h('span', { class: 'badge is-plain' }, ctx.t('servers.plain')),
          ),
          h(
            'div',
            { class: 'server-meta' },
            ctx.t('servers.meta', { origin: server.origin, version: server.version }),
          ),
        ),
        h('div', { class: 'server-actions' }, open, remove),
      ),
    );
  }

  return h(
    'section',
    { 'aria-labelledby': 'servers-heading' },
    h(
      'div',
      { class: 'servers-head' },
      h(
        'div',
        {},
        h('h1', { id: 'servers-heading' }, ctx.t('servers.heading')),
        h('p', { class: 'lead' }, ctx.t('servers.lead')),
      ),
      h(
        'button',
        { type: 'button', class: 'button ghost', onClick: () => ctx.go('connect') },
        ctx.t('servers.add'),
      ),
    ),
    list,
    status,
    h(
      'p',
      { class: 'note' },
      h(
        'button',
        { type: 'button', class: 'link', onClick: () => ctx.go('mode') },
        ctx.t('servers.otherModes'),
      ),
    ),
  );
}
