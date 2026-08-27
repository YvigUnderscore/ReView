// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsGroup from './SettingsGroup';
import type { SettingField } from './adminShared';
import { t } from '../../i18n';

/**
 * La section des réglages du studio empilait onze champs sans rapport dans une seule boîte
 * sans titre, chacun avec son propre bouton « Enregistrer » : on ne savait ni où l'on
 * était, ni ce qu'on validait. Une famille porte désormais son titre et un seul bouton, qui
 * n'envoie que ce qui a changé.
 */
const FIELDS: SettingField[] = [
  {
    key: 'max_concurrent_uploads',
    labelKey: 'settings.maxUploads',
    hintKey: 'settings.hint.maxUploads',
    group: 'uploads',
  },
  {
    key: 'max_file_size',
    labelKey: 'settings.maxFileSize',
    hintKey: 'settings.hint.maxFileSize',
    group: 'uploads',
    bytes: true,
  },
];

const onSave = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  onSave.mockResolvedValue(undefined);
});

const mount = (stored: Record<string, string> = {}) =>
  render(<SettingsGroup group="uploads" fields={FIELDS} stored={stored} onSave={onSave} />);

const saveButton = () => screen.getByRole('button', { name: t('common.save') });

describe('SettingsGroup', () => {
  it('annonce la famille par son titre', () => {
    mount();
    expect(screen.getByText(t('settings.group.uploads'))).toBeTruthy();
  });

  it('n’expose qu’un seul bouton d’enregistrement pour toute la famille', () => {
    mount();
    expect(screen.getAllByRole('button', { name: t('common.save') })).toHaveLength(1);
  });

  it('laisse le bouton inerte tant que rien n’a changé', () => {
    mount({ max_concurrent_uploads: '5' });
    expect(saveButton()).toBeDisabled();
  });

  it('n’envoie que les champs réellement modifiés', async () => {
    const user = userEvent.setup();
    mount({ max_concurrent_uploads: '5', max_file_size: '1000000000' });
    await user.clear(screen.getByLabelText(t('settings.maxUploads')));
    await user.type(screen.getByLabelText(t('settings.maxUploads')), '8');
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith([{ key: 'max_concurrent_uploads', value: '8' }]);
  });

  it('convertit une taille en octets avant de l’envoyer', async () => {
    const user = userEvent.setup();
    // Champ vide : l'unité proposée est Mo, comme avant le regroupement.
    mount({ max_file_size: '' });
    await user.type(screen.getByLabelText(t('settings.maxFileSize')), '2');
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith([{ key: 'max_file_size', value: '2000000' }]);
  });

  it('tient compte du changement d’unité, et le rend enregistrable', async () => {
    const user = userEvent.setup();
    mount({ max_file_size: '' });
    await user.type(screen.getByLabelText(t('settings.maxFileSize')), '2');
    await user.selectOptions(screen.getByLabelText(t('settings.sizeUnit')), 'Go');
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith([{ key: 'max_file_size', value: '2000000000' }]);
  });

  it('relie chaque libellé à son champ — le placeholder n’est pas un nom accessible', () => {
    mount();
    expect(screen.getByLabelText(t('settings.maxUploads'))).toBeTruthy();
    expect(screen.getByLabelText(t('settings.maxFileSize'))).toBeTruthy();
  });
});
