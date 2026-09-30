// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { transport, smtp, createTransport } = vi.hoisted(() => ({
  transport: { sendMail: vi.fn() },
  smtp: { getEffectiveConfig: vi.fn() },
  createTransport: vi.fn(),
}));

vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('../services/SmtpService', () => smtp);
vi.mock('./logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { isMailerConfigured, sendMail } from './mailer';

const CONFIG = {
  host: 'smtp.test',
  port: 587,
  secure: false,
  from: 'ReView <no-reply@test>',
  allowInsecure: false,
};

/** Options passées à nodemailer pour le dernier envoi. */
const lastTransportOptions = () =>
  createTransport.mock.calls[createTransport.mock.calls.length - 1]![0] as {
    requireTLS?: boolean;
    tls?: { minVersion?: string };
  };

beforeEach(() => {
  vi.clearAllMocks();
  createTransport.mockReturnValue(transport);
  smtp.getEffectiveConfig.mockResolvedValue(CONFIG);
  transport.sendMail.mockResolvedValue({});
});

describe('transport — chiffrement exigé (A3-04)', () => {
  it('exige STARTTLS sur un relais en clair', async () => {
    // Sans requireTLS, le STARTTLS du port 587 est opportuniste : un intermédiaire qui
    // retire 250-STARTTLS de l'EHLO fait poursuivre en clair, et le transport livre
    // AUTH LOGIN puis le lien d'invitation — qui pose le mot de passe d'un compte.
    await sendMail('a@b.c', 'Sujet', '<p>x</p>');
    expect(lastTransportOptions().requireTLS).toBe(true);
    expect(lastTransportOptions().tls?.minVersion).toBe('TLSv1.2');
  });

  it('n’exige pas STARTTLS sur un port déjà chiffré de bout en bout', async () => {
    smtp.getEffectiveConfig.mockResolvedValue({ ...CONFIG, port: 465, secure: true });
    await sendMail('a@b.c', 'Sujet', '<p>x</p>');
    expect(lastTransportOptions().requireTLS).toBe(false);
  });

  it('laisse l’échappatoire explicite d’un relais interne sans TLS', async () => {
    smtp.getEffectiveConfig.mockResolvedValue({ ...CONFIG, allowInsecure: true });
    await sendMail('a@b.c', 'Sujet', '<p>x</p>');
    expect(lastTransportOptions().requireTLS).toBe(false);
  });
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
