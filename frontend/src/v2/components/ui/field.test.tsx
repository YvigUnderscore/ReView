// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './field';
import { Input } from './input';

/**
 * The accessible name of a field.
 *
 * This is the most discreet failure in the interface: a `<Label>` placed **beside** the
 * field, visually right and programmatically mute. The Profile page had six of them at once,
 * including both password fields, and callers had tried to patch it by passing an
 * `aria-label` to a local component that did not declare it — the attribute never reached
 * the `<input>`. To a screen reader, the user typed their password into a field with no name.
 *
 * `Field` is the product's answer: it creates the identifier and sets it on both sides.
 * These assertions check it through the accessible name — what the user hears — and not
 * through the presence of an attribute, so another way of naming the field remains possible.
 */
describe('Field', () => {
  it('gives the control the name carried by its label', () => {
    render(
      <Field label="Username">
        <Input value="" onChange={() => undefined} placeholder="shown first" />
      </Field>,
    );
    // A placeholder does not name a field: the label has to answer.
    expect(screen.getByLabelText('Username')).toBeTruthy();
  });

  it('respects the identifier the control already carries', () => {
    render(
      <Field label="Bio">
        <textarea id="profile-bio" defaultValue="" />
      </Field>,
    );
    expect(screen.getByLabelText('Bio').getAttribute('id')).toBe('profile-bio');
  });

  it('links the help to the control rather than letting it float alongside', () => {
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

  it('announces the error and marks the field as invalid', () => {
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

  it('does not share an identifier between two fields on the same page', () => {
    // Two `Field`s side by side: a copied identifier would link both labels to the same
    // field, and the second one would once again have no name.
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
