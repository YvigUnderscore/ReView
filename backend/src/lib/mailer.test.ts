// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { transport, smtp } = vi.hoisted(() => ({
  transport: { sendMail: vi.fn() },
  smtp: { getEffectiveConfig: vi.fn() },
}));

vi.mock('nodemailer', () => ({ default: { createTransport: () => transport } }));
vi.mock('../services/SmtpService', () => smtp);
vi.mock('./logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { isMailerConfigured, sendMail } from './mailer';

const CONFIG = { host: 'smtp.test', port: 587, secure: false, from: 'ReView <no-reply@test>' };

beforeEach(() => {
  vi.clearAllMocks();
  smtp.getEffectiveConfig.mockResolvedValue(CONFIG);
  transport.sendMail.mockResolvedValue({});
});

describe('sendMail', () => {
  it("n'envoie rien sans relais configuré", async () => {
    smtp.getEffectiveConfig.mockResolvedValue(null);
    expect(await sendMail('a@b.c', 'Sujet', '<p>Bonjour</p>')).toBe(false);
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('envoie toujours le HTML ET son équivalent texte', async () => {
    // Un message sans version texte est pénalisé par les filtres, et ses aperçus
    // (liste de boîte, montre, lecteur d'écran) affichent du balisage brut.
    await sendMail('a@b.c', 'Sujet', '<p>Bonjour <b>Alice</b></p>');
    const sent = transport.sendMail.mock.calls[0]![0] as { html: string; text: string };
    expect(sent.html).toContain('<b>Alice</b>');
    expect(sent.text).toBe('Bonjour Alice');
  });

  it('respecte un texte fourni par l’appelant', async () => {
    await sendMail('a@b.c', 'Sujet', '<p>x</p>', { text: 'version soignée' });
    expect((transport.sendMail.mock.calls[0]![0] as { text: string }).text).toBe('version soignée');
  });

  it('marque tout envoi comme automatique', async () => {
    // Sans cela, un répondeur d'absence répond au digest — et la boucle peut se refermer.
    await sendMail('a@b.c', 'Sujet', '<p>x</p>');
    const headers = (transport.sendMail.mock.calls[0]![0] as { headers: Record<string, string> }).headers;
    expect(headers['Auto-Submitted']).toBe('auto-generated');
    expect(headers['X-Auto-Response-Suppress']).toBe('All');
  });

  it('pose le désabonnement en un clic sur les seuls envois récurrents', async () => {
    await sendMail('a@b.c', 'Digest', '<p>x</p>', { unsubscribeUrl: 'https://x/api/unsubscribe/t' });
    const withList = (transport.sendMail.mock.calls[0]![0] as { headers: Record<string, string> }).headers;
    expect(withList['List-Unsubscribe']).toBe('<https://x/api/unsubscribe/t>');
    expect(withList['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    await sendMail('a@b.c', 'Invitation', '<p>x</p>');
    const withoutList = (transport.sendMail.mock.calls[1]![0] as { headers: Record<string, string> }).headers;
    expect(withoutList['List-Unsubscribe']).toBeUndefined();
  });

  it('rend faux plutôt que de lever quand le relais refuse', async () => {
    // Un envoi manqué ne doit pas faire échouer l'action qui l'a déclenché.
    transport.sendMail.mockRejectedValue(new Error('relais injoignable'));
    expect(await sendMail('a@b.c', 'Sujet', '<p>x</p>')).toBe(false);
  });
});

describe('isMailerConfigured', () => {
  it('suit la configuration effective', async () => {
    expect(await isMailerConfigured()).toBe(true);
    smtp.getEffectiveConfig.mockResolvedValue(null);
    expect(await isMailerConfigured()).toBe(false);
  });
});
