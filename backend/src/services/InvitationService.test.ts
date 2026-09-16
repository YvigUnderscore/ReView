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

describe('InvitationService — email d’invitation (Phase 47)', () => {
  it('porte le lien d’activation en bouton ET en clair', () => {
    const html = renderInvitationHtml('en', 'Marie', 'Yvig', URL);
    // Deux fois : le bouton, et le repli pour les clients qui n'affichent pas les liens
    // stylés — c'est justement le cas des messageries d'entreprise les plus verrouillées.
    expect(html.split(URL).length - 1).toBe(3); // href du bouton, href du repli, texte du repli
    expect(html).toContain('Activate my account');
  });

  it('nomme celui qui invite quand on le connaît, reste impersonnel sinon', () => {
    expect(renderInvitationHtml('en', 'Marie', 'Yvig', URL)).toContain('Yvig created an account');
    const anonymous = renderInvitationHtml('en', 'Marie', null, URL);
    expect(anonymous).toContain('An account has been created for you');
    expect(anonymous).not.toContain('Yvig');
  });

  it('annonce la durée de validité réellement appliquée', () => {
    const html = renderInvitationHtml('en', 'Marie', null, URL);
    expect(html).toContain(`expires in ${INVITATION_TTL_DAYS} days`);
  });

  it('échappe le nom du destinataire — un nom n’est pas du HTML', () => {
    const html = renderInvitationHtml('en', '<script>alert(1)</script>', null, URL);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('échappe l’adresse dans l’attribut href du lien de repli, pas seulement dans son texte', () => {
    // `url` vaut `APP_URL` + jeton : rien n'y échappe aujourd'hui. Mais `APP_URL` est une
    // variable d'environnement, et le bouton (`mailButton`) échappe déjà son href — le
    // repli était le dernier attribut brut du message. Un guillemet y referme l'attribut
    // et la suite de la ligne devient du balisage, sous l'habillage du studio.
    const hostile = 'https://review.example.com/invite/a" onmouseover="alert(1)';
    const html = renderInvitationHtml('en', 'Marie', null, hostile);
    // Aucun guillemet brut ne sort de l'adresse : l'attribut ne se referme pas.
    expect(html).not.toContain('/invite/a" onmouseover');
    // Et les TROIS emplacements portent la même forme échappée — le href du bouton, celui
    // du repli, et le texte du repli. Avant le correctif il n'y en avait que deux.
    const escaped = 'https://review.example.com/invite/a&quot; onmouseover=&quot;alert(1)';
    expect(html.split(escaped).length - 1).toBe(3);
  });

  it('reste dans l’enveloppe de marque', () => {
    const html = renderInvitationHtml('en', 'Marie', null, URL);
    expect(html).toContain('Welcome to ReView');
    expect(html).toContain('collaborative review platform'); // pied traduit
  });
});

/**
 * A1-01 — cinquième porte. Un lien d'invitation encore en boîte mail à l'heure du départ ne
 * pose pas seulement un mot de passe : il OUVRE une session dans la foulée (auth.routes.ts,
 * « activer son compte vaut connexion »). Un compte désactivé n'a donc plus d'invitation
 * valide, ni à l'aperçu ni à l'activation.
 */
describe('InvitationService — invitation d’un compte désactivé', () => {
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

  it('traite le lien comme périmé à l’aperçu', async () => {
    db.invitation.findUnique.mockResolvedValue(invitationFor(new Date()));
    await expect(describeInvitation('jeton')).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
  });

  // Le point dur : sans cette garde, l'activation posait un mot de passe neuf sur le compte
  // d'un partant — et lui rendait la main.
  it('refuse l’activation sans rien écrire', async () => {
    db.invitation.findUnique.mockResolvedValue(invitationFor(new Date()));
    await expect(acceptInvitation('jeton', 'Motdepasse1')).rejects.toMatchObject({
      code: 'INVITATION_INVALID',
    });
    expect(db.invitation.updateMany).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('laisse passer un compte actif', async () => {
    db.invitation.findUnique.mockResolvedValue(invitationFor(null));
    await expect(acceptInvitation('jeton', 'Motdepasse1')).resolves.toEqual({ id: 7 });
  });
});
