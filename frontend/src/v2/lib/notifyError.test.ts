// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import { t } from '../i18n';
import { errorMessage, notifyError } from './notifyError';

afterEach(() => {
  toastError.mockReset();
  vi.restoreAllMocks();
});

describe('errorMessage', () => {
  it("prefers the error's own message, else the fallback, else the generic one", () => {
    expect(errorMessage(new Error('Forbidden'), 'x')).toBe('Forbidden');
    expect(errorMessage('boom', 'Fallback')).toBe('Fallback');
    expect(errorMessage(new Error(''), 'Fallback')).toBe('Fallback');
    expect(errorMessage(null)).toBe(t('common.error.generic'));
  });
});

describe('notifyError', () => {
  it('toasts the message and logs the error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new Error('Not allowed');
    notifyError(err);
    expect(toastError).toHaveBeenCalledWith('Not allowed');
    expect(log).toHaveBeenCalledWith(err);
  });
});
