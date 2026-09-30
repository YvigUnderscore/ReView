// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField, type NumberFieldProps } from './number-field';
import { SCRUB_THRESHOLD_PX } from './number-field.math';

/**
 * Le geste de la primitive, celui que les maths ne peuvent pas décider seules : un appui sur
 * le champ est-il un clic (focus + sélection) ou un scrub (la valeur suit le pointeur) ?
 * happy-dom ne pose pas de pointeur : on l'émule, et on stubbe la capture qu'il n'implémente
 * pas. `onChange` est un espion — la valeur affichée reste donc celle de la prop, ce qui rend
 * la valeur de départ d'un geste vérifiable d'un test à l'autre.
 */
const setup = (props: Partial<NumberFieldProps> = {}) => {
  const onChange = vi.fn();
  const view = render(
    <NumberField
      label="mm"
      value={50}
      onChange={onChange}
      min={0}
      max={100}
      step={1}
      pixelsPerStep={4}
      hint="Focal"
      {...props}
    />,
  );
  const field = view.getByRole('textbox') as HTMLInputElement;
  // Le libellé peut être une icône : on ne le cherche par son texte que s'il en a un.
  const label = view.queryByText('mm') ?? (field.previousElementSibling as HTMLElement);
  for (const el of [field, label]) {
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
  }
  return { onChange, field, label, view };
};

/** Appui, déplacement horizontal, relâchement — un geste complet sur un élément. */
const press = (el: Element, clientX: number) =>
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX });
const moveTo = (el: Element, clientX: number, shiftKey = false) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX, shiftKey });
const release = (el: Element, clientX: number) => fireEvent.pointerUp(el, { pointerId: 1, clientX });

describe('NumberField — appui sur le champ', () => {
  it('clic sans mouvement : le champ prend le focus et sa valeur est sélectionnée', () => {
    const { field, onChange } = setup();
    press(field, 100);
    release(field, 100);
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('déplacement sous le seuil : ni valeur modifiée, ni geste reconnu', () => {
    const { field, onChange } = setup();
    press(field, 100);
    moveTo(field, 100 + SCRUB_THRESHOLD_PX - 1);
    expect(onChange).not.toHaveBeenCalled();
    // Le relâchement reste un clic : c'est bien un appui tremblé, pas un scrub raté.
    release(field, 100 + SCRUB_THRESHOLD_PX - 1);
    expect(field).toHaveFocus();
  });

  it('déplacement au-delà du seuil : la valeur suit, le champ ne prend pas le focus', () => {
    const { field, onChange } = setup();
    press(field, 100);
    moveTo(field, 140);
    // 40 px moins le seuil de 4 px = 36 px, soit 9 pas de 1 à 4 px par pas.
    expect(onChange).toHaveBeenLastCalledWith(59);
    release(field, 140);
    expect(field).not.toHaveFocus();
  });

  it('vers la gauche, la valeur descend', () => {
    const { field, onChange } = setup();
    press(field, 100);
    moveTo(field, 60);
    expect(onChange).toHaveBeenLastCalledWith(41);
  });

  it('Maj multiplie le pas par dix', () => {
    const { field, onChange } = setup({ max: 1000 });
    press(field, 100);
    moveTo(field, 140, true);
    expect(onChange).toHaveBeenLastCalledWith(140); // 50 + 9 pas × 10
  });

  it('le scrub reste borné par min et max', () => {
    const haut = setup({ value: 95 });
    press(haut.field, 100);
    moveTo(haut.field, 200);
    expect(haut.onChange).toHaveBeenLastCalledWith(100);
    haut.view.unmount();

    const bas = setup({ value: 5 });
    press(bas.field, 100);
    moveTo(bas.field, 0);
    expect(bas.onChange).toHaveBeenLastCalledWith(0);
  });

  it('champ déjà en saisie : le glissement laisse la sélection de texte tranquille', () => {
    const { field, onChange } = setup();
    field.focus();
    press(field, 100);
    moveTo(field, 200);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('NumberField — Échap', () => {
  it('annule un scrub en cours en restituant la valeur de départ', () => {
    const { field, onChange } = setup();
    press(field, 100);
    moveTo(field, 140);
    expect(onChange).toHaveBeenLastCalledWith(59);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith(50);
    // Le geste est clos : un déplacement de plus ne rappelle plus rien.
    const appels = onChange.mock.calls.length;
    moveTo(field, 200);
    expect(onChange.mock.calls).toHaveLength(appels);
  });

  it('hors scrub, Échap abandonne le brouillon de saisie sans rien commettre', () => {
    const { field, onChange } = setup();
    field.focus();
    fireEvent.change(field, { target: { value: '77' } });
    expect(field.value).toBe('77');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('50');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('NumberField — libellé et clavier', () => {
  it('le libellé scrube toujours, et dès le premier pixel', () => {
    const { label, onChange } = setup();
    press(label, 0);
    moveTo(label, 8);
    // Aucun seuil retiré : 8 px / 4 px par pas = 2 pas.
    expect(onChange).toHaveBeenLastCalledWith(52);
    release(label, 8);
  });

  it('la saisie clavier reste intacte : Entrée commet la valeur tapée', () => {
    const { field, onChange } = setup();
    fireEvent.change(field, { target: { value: '42' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it('le champ reste un input annoncé par son libellé textuel', () => {
    const { field, label } = setup();
    expect(field).toHaveAttribute('aria-labelledby', label.getAttribute('id'));
    expect(field).not.toHaveAttribute('aria-label');
  });

  it('libellé en icône : le rappel sert d’étiquette accessible', () => {
    const { field } = setup({ label: <svg aria-hidden="true" />, hint: 'Focal' });
    expect(field).toHaveAttribute('aria-label', 'Focal');
    expect(field).not.toHaveAttribute('aria-labelledby');
  });
});
