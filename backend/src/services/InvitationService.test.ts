// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { invitation: { findUnique: vi.fn(), updateMany: vi.fn() }, user: { update: vi.fn() } },
}));
vi.mock('../lib/prisma', () => ({ prisma: db }));

import {
  renderInvitationHtml,
  describeInvitation,
  acceptInvitation,
  INVITATION_TTL_DAYS,
} from './InvitationService';

const URL = 'https://review.example.com/invite/abc123';

describe('InvitationService: invitation email (Phase 47)', () => {
  it('carries the activation link as a button AND in plain text', () => {
    const html = renderInvitationHtml('en', 'Marie', 'Yvig', URL);
    // Twice: the button, and the fallback for clients that do not display styled links — precisely the case
    // of the most locked-down corporate messaging systems.
    expect(html.split(URL).length - 1).toBe(3); // button href, fallback href, fallback text
    expect(html).toContain('Activate my account');
  });

  it('names the person inviting when they are known, stays impersonal otherwise', () => {
    expect(renderInvitationHtml('en', 'Marie', 'Yvig', URL)).toContain('Yvig created an account');
    const anonymous = renderInvitationHtml('en', 'Marie', null, URL);
    expect(anonymous).toContain('An account has been created for you');
    expect(anonymous).not.toContain('Yvig');
  });

  it('announces the validity period actually applied', () => {
    const html = renderInvitationHtml('en', 'Marie', null, URL);
    expect(html).toContain(`expires in ${INVITATION_TTL_DAYS} days`);
  });

  it("escapes the recipient's name — a name is not HTML", () => {
    const html = renderInvitationHtml('en', '<script>alert(1)</script>', null, URL);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes the address in the href attribute of the fallback link, not only in its text', () => {
    // `url` is `APP_URL` + token: nothing escapes in it today. But `APP_URL` is an environment variable, and
    // the button (`mailButton`) already escapes its href — the fallback was the last raw attribute of the
    // message. A quotation mark there would close the attribute and the rest of the line would become markup,
    // under the studio's styling.
    const hostile = 'https://review.example.com/invite/a" onmouseover="alert(1)';
    const html = renderInvitationHtml('en', 'Marie', null, hostile);
    // No raw quotation mark comes out of the address: the attribute does not close.
    expect(html).not.toContain('/invite/a" onmouseover');
    // And the THREE locations carry the same escaped form — the button's href, the fallback's href, and the
    // fallback text. Before the fix there were only two.
    const escaped = 'https://review.example.com/invite/a&quot; onmouseover=&quot;alert(1)';
    expect(html.split(escaped).length - 1).toBe(3);
  });

  it('stays within the brand envelope', () => {
    const html = renderInvitationHtml('en', 'Marie', null, URL);
    expect(html).toContain('Welcome to ReView');
    expect(html).toContain('collaborative review platform'); // translated footer
  });
});

/**
 * A1-01 — fifth gate. An invitation link still in a mailbox at the time of departure does not merely set a
 * password: it OPENS a session straight away (auth.routes.ts, "activating one's account means logging in").
 * An account that is disabled therefore has no valid invitation any more, neither at preview nor at
 * activation.
 */
describe('InvitationService: invitation of a disabled account', () => {
  const invitationFor = (disabledAt: Date | null) => ({
    id: 3,
    userId: 7,
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    user: { id: 7, email: 'partie@studio.com', name: 'Marie', disabledAt },
    invitedBy: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db.invitation.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockResolvedValue({ id: 7 });
  });

  it('treats the link as expired at preview', async () => {
    db.invitation.findUnique.mockResolvedValue(invitationFor(new Date()));
    await expect(describeInvitation('jeton')).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
  });

  // The hard point: without this guard, activation would set a new password on a departing person's account —
  // and hand it back to them.
  it('refuses activation without writing anything', async () => {
    db.invitation.findUnique.mockResolvedValue(invitationFor(new Date()));
    await expect(acceptInvitation('jeton', 'Motdepasse1')).rejects.toMatchObject({
      code: 'INVITATION_INVALID',
    });
    expect(db.invitation.updateMany).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('lets an active account through', async () => {
    db.invitation.findUnique.mockResolvedValue(invitationFor(null));
    await expect(acceptInvitation('jeton', 'Motdepasse1')).resolves.toEqual({ id: 7 });
  });
});
