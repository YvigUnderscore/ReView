// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsFields from './SettingsFields';
import type { SettingField } from './studioSettings';
import { t } from '../../i18n';

/**
 * What the byte conversion and the "what changed" calculation become once on
 * screen lives in `studioSettings.test.ts`. What stays here are the two properties no
 * pure module can assert: the component carries **no** save button —
 * the page holds a single one — and each label really names its field.
 */
const FIELDS: SettingField[] = [
  {
    key: 'max_concurrent_uploads',
    labelKey: 'settings.maxUploads',
    hintKey: 'settings.hint.maxUploads',
    home: 'storage',
  },
  {
    key: 'max_file_size',
    labelKey: 'settings.maxFileSize',
    hintKey: 'settings.hint.maxFileSize',
    home: 'storage',
    bytes: true,
  },
];

const onChange = vi.fn();
const onUnit = vi.fn();
beforeEach(() => vi.clearAllMocks());

const mount = (stored: Record<string, string> = {}) =>
  render(
    <SettingsFields
      fields={FIELDS}
      stored={stored}
      draft={{}}
      units={{}}
      onChange={onChange}
      onUnit={onUnit}
    />,
  );

describe('SettingsFields', () => {
  it('adds no save button — the page holds a single one', () => {
    mount();
    expect(screen.queryByRole('button', { name: t('common.save') })).toBeNull();
  });

  it('links each label to its field — greyed text is not an accessible name', () => {
    mount();
    expect(screen.getByLabelText(t('settings.maxUploads'))).toBeTruthy();
    expect(screen.getByLabelText(t('settings.maxFileSize'))).toBeTruthy();
    expect(screen.getByLabelText(t('settings.sizeUnit'))).toBeTruthy();
  });

  it('displays the saved value, put back into its readable unit', () => {
    // Base 1024 and international symbols: the selector said "Mo"/"Go" (French served to
    // all fourteen languages) and counted in base 1000, the opposite of `formatBytes`.
    mount({ max_concurrent_uploads: '5', max_file_size: String(2 * 1024 ** 3) });
    expect(screen.getByLabelText<HTMLInputElement>(t('settings.maxUploads')).value).toBe('5');
    expect(screen.getByLabelText<HTMLInputElement>(t('settings.maxFileSize')).value).toBe('2');
    expect(screen.getByLabelText<HTMLSelectElement>(t('settings.sizeUnit')).value).toBe('GB');
  });

  it('passes the input up to the page instead of keeping it', async () => {
    const user = userEvent.setup();
    mount({ max_concurrent_uploads: '5' });
    await user.type(screen.getByLabelText(t('settings.maxUploads')), '8');
    expect(onChange).toHaveBeenCalledWith('max_concurrent_uploads', '58');
  });

  it('passes the unit change up — it changes the value sent', async () => {
    const user = userEvent.setup();
    mount({ max_file_size: String(2 * 1024 ** 2) });
    await user.selectOptions(screen.getByLabelText(t('settings.sizeUnit')), 'GB');
    expect(onUnit).toHaveBeenCalledWith(FIELDS[1], 'GB');
  });
});
