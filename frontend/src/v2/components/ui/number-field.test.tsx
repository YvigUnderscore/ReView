// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField, type NumberFieldProps } from './number-field';
import { SCRUB_THRESHOLD_PX } from './number-field.math';

/**
 * The primitive's gesture, which the maths cannot decide alone: does a press on the field
 * count as a click (focus + selection) or a scrub (the value follows the pointer)?
 * happy-dom does not provide a pointer: we emulate it, and stub the capture it does not
 * implement. `onChange` is a spy — the displayed value therefore stays at the prop's value,
 * which makes the starting value of a gesture verifiable from one test to the next.
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
  // The label may be an icon: we only look it up by its text if it has one.
  const label = view.queryByText('mm') ?? (field.previousElementSibling as HTMLElement);
  for (const el of [field, label]) {
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
  }
  return { onChange, field, label, view };
};

/** Press, horizontal move, release — a complete gesture on an element. */
const press = (el: Element, clientX: number) =>
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX });
const moveTo = (el: Element, clientX: number, shiftKey = false) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX, shiftKey });
const release = (el: Element, clientX: number) => fireEvent.pointerUp(el, { pointerId: 1, clientX });

describe('NumberField — press on the field', () => {
  it('click without movement: the field takes focus and its value is selected', () => {
    const { field, onChange } = setup();
    press(field, 100);
    release(field, 100);
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('movement below the threshold: no value changed, no gesture recognised', () => {
    const { field, onChange } = setup();
    press(field, 100);
    moveTo(field, 100 + SCRUB_THRESHOLD_PX - 1);
    expect(onChange).not.toHaveBeenCalled();
    // Release stays a click: it is a shaky press, not a failed scrub.
    release(field, 100 + SCRUB_THRESHOLD_PX - 1);
    expect(field).toHaveFocus();
  });

  it('movement beyond the threshold: the value follows, the field does not take focus', () => {
    const { field, onChange } = setup();
    press(field, 100);
    moveTo(field, 140);
    // 40 px minus the 4 px threshold = 36 px, i.e. 9 steps of 1 at 4 px per step.
    expect(onChange).toHaveBeenLastCalledWith(59);
    release(field, 140);
    expect(field).not.toHaveFocus();
  });

  it('leftwards, the value goes down', () => {
    const { field, onChange } = setup();
    press(field, 100);
    moveTo(field, 60);
    expect(onChange).toHaveBeenLastCalledWith(41);
  });

  it('Shift multiplies the step by ten', () => {
    const { field, onChange } = setup({ max: 1000 });
    press(field, 100);
    moveTo(field, 140, true);
    expect(onChange).toHaveBeenLastCalledWith(140); // 50 + 9 steps × 10
  });

  it('the scrub stays bounded by min and max', () => {
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

  it('field already being edited: dragging leaves the text selection alone', () => {
    const { field, onChange } = setup();
    field.focus();
    press(field, 100);
    moveTo(field, 200);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('NumberField — Escape', () => {
  it('cancels a scrub in progress, restoring the starting value', () => {
    const { field, onChange } = setup();
    press(field, 100);
    moveTo(field, 140);
    expect(onChange).toHaveBeenLastCalledWith(59);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith(50);
    // The gesture is closed: a further move no longer calls anything.
    const appels = onChange.mock.calls.length;
    moveTo(field, 200);
    expect(onChange.mock.calls).toHaveLength(appels);
  });

  it('outside a scrub, Escape discards the draft input without committing anything', () => {
    const { field, onChange } = setup();
    field.focus();
    fireEvent.change(field, { target: { value: '77' } });
    expect(field.value).toBe('77');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('50');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('NumberField — label and keyboard', () => {
  it('the label always scrubs, from the very first pixel', () => {
    const { label, onChange } = setup();
    press(label, 0);
    moveTo(label, 8);
    // No threshold removed: 8 px / 4 px per step = 2 steps.
    expect(onChange).toHaveBeenLastCalledWith(52);
    release(label, 8);
  });

  it('keyboard input stays intact: Enter commits the typed value', () => {
    const { field, onChange } = setup();
    fireEvent.change(field, { target: { value: '42' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it('the field remains an input announced by its text label', () => {
    const { field, label } = setup();
    expect(field).toHaveAttribute('aria-labelledby', label.getAttribute('id'));
    expect(field).not.toHaveAttribute('aria-label');
  });

  it('icon label: the reminder serves as the accessible label', () => {
    const { field } = setup({ label: <svg aria-hidden="true" />, hint: 'Focal' });
    expect(field).toHaveAttribute('aria-label', 'Focal');
    expect(field).not.toHaveAttribute('aria-labelledby');
  });
});
