// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { safeFetch, OutboundBlockedError, OutboundTimeoutError, OutboundTooLargeError } from './safeFetch';

/**
 * `safeFetch` est le seul point de sortie du backend : ces tests décrivent ce qu'il refuse
 * (adresse interne, lien-local, nom qui résout en privé, redirection vers l'intérieur,
 * attente sans fin, réponse démesurée) et ce qu'il laisse passer.
 */

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

const text = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
  fetchMock = vi.fn<typeof fetch>();
  fetchMock.mockResolvedValue(text('ok'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('safeFetch — cibles refusées', () => {
  it('refuse une adresse privée littérale sans émettre la requête', async () => {
    await expect(safeFetch('http://10.0.0.5/admin')).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse la boucle locale et le lien-local des métadonnées cloud', async () => {
    for (const url of [
      'http://127.0.0.1:9000/review/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:6379/',
    ])
      await expect(safeFetch(url), url).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse un nom public qui résout vers une adresse interne', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(safeFetch('https://interne.exemple.com/hook')).rejects.toMatchObject({
      code: 'OUTBOUND_BLOCKED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse les schémas autres que http(s)', async () => {
    for (const url of ['file:///etc/passwd', 'redis://cache:6379', 'gopher://x/'])
      await expect(safeFetch(url), url).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it('refuse une URL inexploitable', async () => {
    await expect(safeFetch('pas une url')).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});

describe('safeFetch — redirections', () => {
  it('ne suit aucune redirection par défaut', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://ailleurs.exemple.com/'));
    await expect(safeFetch('https://site.exemple.com/x')).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Le mode manuel est le seul qui laisse la décision au code appelant.
    expect((fetchMock.mock.calls[0]![1] as RequestInit).redirect).toBe('manual');
  });

  // Le cœur du correctif : une garde posée AVANT la requête ne vaut rien si la cible peut
  // ensuite renvoyer une redirection vers l'intérieur du réseau.
  it('revérifie chaque saut et refuse une redirection vers une adresse interne', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data/'));
    await expect(safeFetch('https://site.exemple.com/x', {}, { maxRedirects: 3 })).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    // La deuxième requête n'a jamais été émise.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('suit une redirection vers une cible publique quand on l’y autorise', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://cdn.exemple.com/fichier'));
    fetchMock.mockResolvedValueOnce(text('contenu'));
    const res = await safeFetch('https://site.exemple.com/x', {}, { maxRedirects: 3 });
    expect(await res.text()).toBe('contenu');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://cdn.exemple.com/fichier');
  });

  it('résout une redirection relative sur l’URL courante', async () => {
    fetchMock.mockResolvedValueOnce(redirect('/ailleurs'));
    fetchMock.mockResolvedValueOnce(text('contenu'));
    await safeFetch('https://site.exemple.com/dossier/x', {}, { maxRedirects: 1 });
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://site.exemple.com/ailleurs');
  });

  it('s’arrête au nombre de sauts autorisé', async () => {
    fetchMock.mockResolvedValue(redirect('https://boucle.exemple.com/'));
    await expect(safeFetch('https://site.exemple.com/x', {}, { maxRedirects: 2 })).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('ne rejoue jamais un POST vers une cible choisie par le serveur', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://ailleurs.exemple.com/'));
    await expect(
      safeFetch('https://site.exemple.com/x', { method: 'POST', body: 'secret' }, { maxRedirects: 3 }),
    ).rejects.toMatchObject({ reason: expect.stringContaining('POST') as unknown as string });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('safeFetch — délai d’attente', () => {
  it('abandonne si les en-têtes n’arrivent pas', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit).signal!;
          signal.addEventListener('abort', () => reject(signal.reason as Error));
        }),
    );
    await expect(safeFetch('https://lent.exemple.com/', {}, { timeoutMs: 10 })).rejects.toBeInstanceOf(
      OutboundTimeoutError,
    );
  });

  it('laisse le corps se lire une fois la réponse ouverte', async () => {
    // Le minuteur ne porte que sur les en-têtes : un master de dailies met plus longtemps
    // à descendre que n'importe quel délai raisonnable.
    fetchMock.mockResolvedValueOnce(text('charge utile'));
    const res = await safeFetch('https://site.exemple.com/', {}, { timeoutMs: 20 });
    await new Promise((r) => setTimeout(r, 40));
    expect(await res.text()).toBe('charge utile');
  });
});

describe('safeFetch — taille de réponse', () => {
  it('refuse d’emblée une taille annoncée hors plafond', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('x', { status: 200, headers: { 'content-length': '10000' } }),
    );
    await expect(safeFetch('https://site.exemple.com/', {}, { maxBytes: 100 })).rejects.toBeInstanceOf(
      OutboundTooLargeError,
    );
  });

  it('coupe un corps qui dépasse le plafond malgré une annonce honnête', async () => {
    fetchMock.mockResolvedValueOnce(text('x'.repeat(500)));
    const res = await safeFetch('https://site.exemple.com/', {}, { maxBytes: 100 });
    await expect(res.text()).rejects.toBeInstanceOf(OutboundTooLargeError);
  });

  it('laisse passer une réponse sous le plafond', async () => {
    fetchMock.mockResolvedValueOnce(text('court'));
    const res = await safeFetch('https://site.exemple.com/', {}, { maxBytes: 1000 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('court');
  });
});

describe('safeFetch — cas passants', () => {
  it('émet vers une cible publique et rend la réponse telle quelle', async () => {
    fetchMock.mockResolvedValueOnce(text('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    const res = await safeFetch('https://hooks.slack.com/services/x', { method: 'POST', body: '{}' });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });

  // Unique échappatoire : le simulateur de développement vit sur une adresse privée.
  it('dispense les hôtes explicitement autorisés, sans résoudre le nom', async () => {
    const res = await safeFetch(
      'http://host.docker.internal:8890/api/v1.1/',
      {},
      { allowHosts: ['HOST.DOCKER.INTERNAL:8890'] },
    );
    expect(res.status).toBe(200);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('n’étend pas la dispense à un autre port du même hôte', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '192.168.65.2', family: 4 }] as never);
    await expect(
      safeFetch('http://host.docker.internal:9000/', {}, { allowHosts: ['host.docker.internal:8890'] }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it('refuse un schéma interdit même pour un hôte dispensé', async () => {
    await expect(safeFetch('file:///etc/passwd', {}, { allowHosts: [''] })).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
  });
});
