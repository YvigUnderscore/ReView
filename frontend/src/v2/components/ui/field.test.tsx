// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './field';
import { Input } from './input';

/**
 * Le nom accessible d'un champ.
 *
 * C'est la panne la plus discrète de l'interface : un `<Label>` posé **à côté** du champ,
 * visuellement juste et programmatiquement muet. La page Profil en portait six d'un coup,
 * dont les deux champs de mot de passe, et les appelants avaient tenté de rattraper le coup
 * en passant un `aria-label` à un composant local qui ne le déclarait pas — l'attribut
 * n'atteignait jamais l'`<input>`. Au lecteur d'écran, on saisissait son mot de passe dans
 * un champ sans nom.
 *
 * `Field` est la réponse du produit : il fabrique l'identifiant et le pose des deux côtés.
 * Ces assertions le vérifient par le nom accessible — ce que l'utilisateur entend — et non
 * par la présence d'un attribut, pour qu'une autre façon de nommer le champ reste possible.
 */
describe('Field', () => {
  it('donne au contrôle le nom que porte son libellé', () => {
    render(
      <Field label="Username">
        <Input value="" onChange={() => undefined} placeholder="shown first" />
      </Field>,
    );
    // Le placeholder ne nomme pas un champ : c'est le libellé qui doit répondre.
    expect(screen.getByLabelText('Username')).toBeTruthy();
  });

  it('respecte l’identifiant que le contrôle porte déjà', () => {
    render(
      <Field label="Bio">
        <textarea id="profile-bio" defaultValue="" />
      </Field>,
    );
    expect(screen.getByLabelText('Bio').getAttribute('id')).toBe('profile-bio');
  });

  it('relie l’aide au contrôle plutôt que de la laisser flotter à côté', () => {
    render(
      <Field label="New password" hint="8 characters min.">
        <Input type="password" value="" onChange={() => undefined} />
      </Field>,
    );
    const input = screen.getByLabelText('New password');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('8 characters min.');
  });

  it('annonce l’erreur et marque le champ comme invalide', () => {
    render(
      <Field label="Email" error="Already taken">
        <Input type="email" value="" onChange={() => undefined} />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy!)?.textContent).toBe('Already taken');
  });

  it('ne partage pas un identifiant entre deux champs de la même page', () => {
    // Deux `Field` côte à côte : un identifiant recopié relierait les deux libellés au
    // même champ, et le second n'aurait de nouveau plus de nom.
    render(
      <>
        <Field label="First name">
          <Input value="" onChange={() => undefined} />
        </Field>
        <Field label="Last name">
          <Input value="" onChange={() => undefined} />
        </Field>
      </>,
    );
    const first = screen.getByLabelText('First name').getAttribute('id');
    const last = screen.getByLabelText('Last name').getAttribute('id');
    expect(first).toBeTruthy();
    expect(first).not.toBe(last);
  });
});
