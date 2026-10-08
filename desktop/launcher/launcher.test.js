// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { start } from './app.js';
import { hostOf } from './views/connect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fetchJson = async (p) => JSON.parse(readFileSync(path.join(here, p), 'utf8'));
const flush = () => new Promise((r) => setTimeout(r, 0));

const SERVER = {
  origin: 'https://review.durian.fr',
  host: 'review.durian.fr',
  secure: true,
  version: '2.0.0',
  studioName: 'Studio Durian',
  addedAt: 1,
  lastOpenedAt: 2,
};

function fakeApi(servers = []) {
  let list = [...servers];
  return {
    appInfo: vi.fn(async () => ({ version: '0.2.0' })),
    listServers: vi.fn(async () => list),
    connect: vi.fn(async () => {
      list = [SERVER];
      return SERVER;
    }),
    removeServer: vi.fn(async (origin) => {
      list = list.filter((s) => s.origin !== origin);
    }),
    ready: vi.fn(async () => {}),
    openDiagnostic: vi.fn(async () => {}),
    openNotices: vi.fn(async () => {}),
    openLink: vi.fn(async () => {}),
  };
}

let root;
let footer;
beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main><footer id="footer"></footer>';
  root = document.getElementById('app');
  footer = document.getElementById('footer');
});

const boot = (api, languages = ['fr-FR']) => start({ root, footer, api, languages, fetchJson, win: window });
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('premier lancement', () => {
  it('propose trois cartes aux mots de la maquette, aucune présélectionnée', async () => {
    const api = fakeApi();
    await boot(api);
    expect(root.dataset.screen).toBe('mode');
    expect(root.querySelector('h1').textContent).toBe('Comment veux-tu travailler ?');
    const cards = [...root.querySelectorAll('.card')];
    expect(cards.map((c) => c.querySelector('.card-title').textContent)).toEqual([
      'Créer un projet ici',
      'Rejoindre un projet',
      'Serveur ReView',
    ]);
    // Les trois mêmes questions, dans le même ordre, sur chaque carte.
    for (const c of cards) {
      expect([...c.querySelectorAll('dt')].map((d) => d.textContent)).toEqual([
        'Sur ce disque',
        'Partagé',
        'Si tu fermes',
      ]);
    }
    expect(cards[2].querySelector('dd').textContent).toBe('rien');
    expect(document.activeElement).toBe(document.body);
    expect(api.ready).toHaveBeenCalledTimes(1);
  });

  it('annonce les modes pas encore livrés sans les rendre actionnables', async () => {
    await boot(fakeApi());
    const [local, join, server] = root.querySelectorAll('.card');
    expect(local.getAttribute('aria-disabled')).toBe('true');
    expect(join.getAttribute('aria-disabled')).toBe('true');
    expect(server.hasAttribute('aria-disabled')).toBe(false);
    expect(local.querySelector('.soon').textContent).toBe('Dans une prochaine mise à jour');
    // L'accent désigne ce qu'on peut choisir, jamais une carte inactive.
    expect([...root.querySelectorAll('.card.is-main')]).toEqual([server]);
    local.click();
    await flush();
    expect(root.dataset.screen).toBe('mode');
  });

  it('retombe sur l’anglais pour une langue que l’application ne parle pas', async () => {
    await boot(fakeApi(), ['it-IT']);
    expect(root.querySelector('h1').textContent).toBe('How do you want to work?');
    expect(document.documentElement.lang).toBe('en');
  });

  it('montre la fenêtre même si la lecture des serveurs échoue', async () => {
    const api = fakeApi();
    api.listServers.mockRejectedValueOnce(new Error('disque'));
    await expect(boot(api)).rejects.toThrow('disque');
    expect(api.ready).toHaveBeenCalledTimes(1);
  });
});

describe('connexion à un serveur', () => {
  async function openConnect(api) {
    await boot(api);
    root.querySelector('[data-mode="server"]').click();
    await flush();
    return root.querySelector('#server-address');
  }

  it('vérifie, ouvre, puis présente la liste des serveurs', async () => {
    const api = fakeApi();
    const input = await openConnect(api);
    expect(document.activeElement).toBe(input);
    input.value = ' review.durian.fr ';
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(root.querySelector('.status').textContent).toBe('Vérification de review.durian.fr…');
    await flush();
    await flush();
    expect(api.connect).toHaveBeenCalledWith(' review.durian.fr ', 'Serveur ReView · rien sur ce disque');
    expect(root.dataset.screen).toBe('servers');
    expect(root.querySelector('.server-name').textContent).toContain('Studio Durian');
    expect(root.querySelector('.badge').textContent).toBe('Rien sur ce disque');
  });

  it('dit pourquoi un serveur est refusé et rend la main', async () => {
    const api = fakeApi();
    api.connect.mockRejectedValueOnce({ code: 'not_review', detail: null });
    const input = await openConnect(api);
    input.value = 'example.com';
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const status = root.querySelector('.status');
    expect(status.className).toContain('is-error');
    expect(status.textContent).toBe(
      'Un serveur répond à cette adresse, mais ce n’est pas un serveur ReView.',
    );
    expect(input.disabled).toBe(false);
    expect(root.dataset.screen).toBe('connect');
  });

  it('affiche le détail technique d’une erreur réseau, pas celui d’un code HTTP', async () => {
    const api = fakeApi();
    api.connect.mockRejectedValueOnce({ code: 'unreachable', detail: 'connection refused' });
    const input = await openConnect(api);
    input.value = 'review.local';
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(root.querySelector('.detail').textContent).toBe('connection refused');

    api.connect.mockRejectedValueOnce({ code: 'http_status', detail: '502' });
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(root.querySelector('.status').textContent).toBe('Le serveur a répondu par une erreur (502).');
    expect(root.querySelector('.detail').textContent).toBe('');
  });

  it('prévient qu’une adresse http:// circule en clair', async () => {
    const input = await openConnect(fakeApi());
    input.value = 'http://192.168.1.20:3429';
    input.dispatchEvent(new Event('input'));
    expect(root.querySelector('.status').className).toContain('is-warning');
  });

  it('nomme l’hôte vérifié quelle que soit la saisie', () => {
    expect(hostOf('https://review.fr:8443/projects?x=1')).toBe('review.fr:8443');
    expect(hostOf('  review.fr  ')).toBe('review.fr');
  });
});

describe('serveurs connus', () => {
  it('arrive directement sur la liste et rouvre un serveur', async () => {
    const api = fakeApi([SERVER]);
    await boot(api);
    expect(root.dataset.screen).toBe('servers');
    button('Ouvrir').click();
    await flush();
    expect(api.connect).toHaveBeenCalledWith(SERVER.origin, 'Serveur ReView · rien sur ce disque');
  });

  it('ne retire un serveur qu’au second clic, puis revient au choix du mode', async () => {
    const api = fakeApi([SERVER]);
    await boot(api);
    button('Retirer').click();
    expect(api.removeServer).not.toHaveBeenCalled();
    button('Confirmer le retrait').click();
    await flush();
    await flush();
    expect(api.removeServer).toHaveBeenCalledWith(SERVER.origin);
    expect(root.dataset.screen).toBe('mode');
  });

  it('n’interprète jamais le nom d’un studio comme du HTML', async () => {
    const api = fakeApi([{ ...SERVER, studioName: '<img src=x onerror=alert(1)>' }]);
    await boot(api);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.server-name').textContent).toContain('<img src=x');
  });

  it('signale un serveur non chiffré', async () => {
    await boot(fakeApi([{ ...SERVER, secure: false, origin: 'http://10.0.0.2:3429' }]));
    expect(root.querySelector('.badge.is-plain').textContent).toBe('Non chiffré');
  });
});

describe('pied', () => {
  it('ouvre diagnostic, licences et code source', async () => {
    const api = fakeApi();
    await boot(api);
    expect(footer.textContent).toContain('ReView Desktop 0.2.0 · alpha');
    button('Diagnostic').click();
    button('Licences tierces').click();
    button('Code source').click();
    expect(api.openDiagnostic).toHaveBeenCalledWith('Diagnostic du webview');
    expect(api.openNotices).toHaveBeenCalledWith('Licences tierces');
    expect(api.openLink).toHaveBeenCalledWith('source');
  });
});
