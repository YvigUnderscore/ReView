// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { loadI18n } from './lib/i18n.js';
import { renderConnect } from './views/connect.js';
import { renderFooter } from './views/footer.js';
import { renderMode } from './views/mode.js';
import { renderServers } from './views/servers.js';

/**
 * Lanceur : trois écrans (choix du mode, connexion, serveurs) et un pied. Sans serveur
 * connu, on arrive sur le choix du mode ; ensuite, directement sur la liste.
 */
export function createLauncher({ root, footer, api, t, info }) {
  let servers = [];
  let current = null;

  const ctx = {
    t,
    api,
    info,
    hasServers: () => servers.length > 0,
    go: (screen, params) => void show(screen, params),
  };

  async function show(screen, params = {}) {
    if (screen === 'servers') {
      servers = await api.listServers();
      if (!servers.length) screen = 'mode';
    }
    current = screen;
    const view =
      screen === 'connect'
        ? renderConnect(ctx, params)
        : screen === 'servers'
          ? renderServers(ctx, servers)
          : renderMode(ctx);
    root.replaceChildren(view);
    root.dataset.screen = screen;
    const field = root.querySelector('#server-address');
    if (field) field.focus();
  }

  footer.replaceChildren(...renderFooter(ctx));

  return {
    show,
    get screen() {
      return current;
    },
    /** Le lanceur réapparaît quand la dernière fenêtre de serveur se ferme : on relit la liste. */
    refresh: () => (current === 'servers' ? show('servers') : Promise.resolve()),
  };
}

/** Démarre le lanceur et montre la fenêtre — même si quelque chose a échoué en route. */
export async function start({ root, footer, api, languages, fetchJson, win }) {
  try {
    const { lang, t } = await loadI18n(languages, fetchJson);
    document.documentElement.lang = lang;
    const info = await api.appInfo();
    const launcher = createLauncher({ root, footer, api, t, info });
    const servers = await api.listServers();
    await launcher.show(servers.length ? 'servers' : 'mode');
    win?.addEventListener('focus', () => void launcher.refresh());
    return launcher;
  } finally {
    // Attendre une image peinte avant d'afficher la fenêtre : jamais de cadre blanc.
    await new Promise((resolve) =>
      win?.requestAnimationFrame ? win.requestAnimationFrame(() => resolve()) : resolve(),
    );
    await api.ready();
  }
}
