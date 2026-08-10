// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderInvitationHtml, INVITATION_TTL_DAYS } from './InvitationService';

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

  it('reste dans l’enveloppe de marque', () => {
    const html = renderInvitationHtml('en', 'Marie', null, URL);
    expect(html).toContain('Welcome to ReView');
    expect(html).toContain('collaborative review platform'); // pied traduit
  });
});
