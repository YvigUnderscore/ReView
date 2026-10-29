// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { transport, smtp, createTransport } = vi.hoisted(() => ({
  transport: { sendMail: vi.fn() },
  smtp: { getEffectiveConfig: vi.fn() },
  createTransport: vi.fn(),
}));

vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('./smtpSettings', () => smtp);
vi.mock('./logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { isMailerConfigured, sendMail } from './mailer';

const CONFIG = {
  host: 'smtp.test',
  port: 587,
  secure: false,
  from: 'ReView <no-reply@test>',
  allowInsecure: false,
};

/** Options passed to nodemailer for the last send. */
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

describe('transport — encryption required (A3-04)', () => {
  it('requires STARTTLS on a cleartext relay', async () => {
    // Without requireTLS, STARTTLS on port 587 is opportunistic: an intermediary that strips 250-STARTTLS from the
    // EHLO makes the dialogue continue in clear text, and the transport then sends AUTH LOGIN followed by the
    // invitation link — which sets the password of an account.
    await sendMail('a@b.c', 'Sujet', '<p>x</p>');
    expect(lastTransportOptions().requireTLS).toBe(true);
    expect(lastTransportOptions().tls?.minVersion).toBe('TLSv1.2');
  });

  it('does not require STARTTLS on a port already encrypted end to end', async () => {
    smtp.getEffectiveConfig.mockResolvedValue({ ...CONFIG, port: 465, secure: true });
    await sendMail('a@b.c', 'Sujet', '<p>x</p>');
    expect(lastTransportOptions().requireTLS).toBe(false);
  });

  it('keeps the explicit escape hatch of an internal relay without TLS', async () => {
    smtp.getEffectiveConfig.mockResolvedValue({ ...CONFIG, allowInsecure: true });
    await sendMail('a@b.c', 'Sujet', '<p>x</p>');
    expect(lastTransportOptions().requireTLS).toBe(false);
  });
});

describe('sendMail', () => {
  it('sends nothing without a configured relay', async () => {
    smtp.getEffectiveConfig.mockResolvedValue(null);
    expect(await sendMail('a@b.c', 'Sujet', '<p>Bonjour</p>')).toBe(false);
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('always sends the HTML AND its text equivalent', async () => {
    // A message without a text version is penalised by filters, and its previews (mailbox list, watch, screen
    // reader) show raw markup.
    await sendMail('a@b.c', 'Sujet', '<p>Bonjour <b>Alice</b></p>');
    const sent = transport.sendMail.mock.calls[0]![0] as { html: string; text: string };
    expect(sent.html).toContain('<b>Alice</b>');
    expect(sent.text).toBe('Bonjour Alice');
  });

  it('respects a text supplied by the caller', async () => {
    await sendMail('a@b.c', 'Sujet', '<p>x</p>', { text: 'version soignée' });
    expect((transport.sendMail.mock.calls[0]![0] as { text: string }).text).toBe('version soignée');
  });

  it('marks every send as automatic', async () => {
    // Otherwise an out-of-office responder replies to the digest — and the loop can close.
    await sendMail('a@b.c', 'Sujet', '<p>x</p>');
    const headers = (transport.sendMail.mock.calls[0]![0] as { headers: Record<string, string> }).headers;
    expect(headers['Auto-Submitted']).toBe('auto-generated');
    expect(headers['X-Auto-Response-Suppress']).toBe('All');
  });

  it('sets one-click unsubscribe on recurring sends only', async () => {
    await sendMail('a@b.c', 'Digest', '<p>x</p>', { unsubscribeUrl: 'https://x/api/unsubscribe/t' });
    const withList = (transport.sendMail.mock.calls[0]![0] as { headers: Record<string, string> }).headers;
    expect(withList['List-Unsubscribe']).toBe('<https://x/api/unsubscribe/t>');
    expect(withList['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    await sendMail('a@b.c', 'Invitation', '<p>x</p>');
    const withoutList = (transport.sendMail.mock.calls[1]![0] as { headers: Record<string, string> }).headers;
    expect(withoutList['List-Unsubscribe']).toBeUndefined();
  });

  it('returns false rather than throwing when the relay refuses', async () => {
    // A missed send must not make the action that triggered it fail.
    transport.sendMail.mockRejectedValue(new Error('relais injoignable'));
    expect(await sendMail('a@b.c', 'Sujet', '<p>x</p>')).toBe(false);
  });
});

describe('isMailerConfigured', () => {
  it('follows the effective configuration', async () => {
    expect(await isMailerConfigured()).toBe(true);
    smtp.getEffectiveConfig.mockResolvedValue(null);
    expect(await isMailerConfigured()).toBe(false);
  });
});
