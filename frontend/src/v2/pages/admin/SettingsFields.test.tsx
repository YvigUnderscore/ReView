// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsFields from './SettingsFields';
import type { SettingField } from './studioSettings';
import { t } from '../../i18n';

/**
 * Ce que la conversion en octets et le calcul de « ce qui a changé » deviennent une fois à
 * l'écran vit dans `studioSettings.test.ts`. Restent ici les deux propriétés qu'aucun
 * module pur ne peut affirmer : le composant ne porte **aucun** bouton d'enregistrement —
 * la page en tient un seul — et chaque libellé nomme réellement son champ.
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
  it('n’ajoute aucun bouton d’enregistrement — la page en tient un seul', () => {
    mount();
    expect(screen.queryByRole('button', { name: t('common.save') })).toBeNull();
  });

  it('relie chaque libellé à son champ — le texte grisé n’est pas un nom accessible', () => {
    mount();
    expect(screen.getByLabelText(t('settings.maxUploads'))).toBeTruthy();
    expect(screen.getByLabelText(t('settings.maxFileSize'))).toBeTruthy();
    expect(screen.getByLabelText(t('settings.sizeUnit'))).toBeTruthy();
  });

  it('affiche la valeur enregistrée, remise dans son unité lisible', () => {
    // Base 1024 et symboles internationaux : le sélecteur disait « Mo »/« Go » (du français
    // servi aux quatorze langues) et comptait en base 1000, à rebours de `formatBytes`.
    mount({ max_concurrent_uploads: '5', max_file_size: String(2 * 1024 ** 3) });
    expect(screen.getByLabelText<HTMLInputElement>(t('settings.maxUploads')).value).toBe('5');
    expect(screen.getByLabelText<HTMLInputElement>(t('settings.maxFileSize')).value).toBe('2');
    expect(screen.getByLabelText<HTMLSelectElement>(t('settings.sizeUnit')).value).toBe('GB');
  });

  it('remonte la saisie à la page plutôt que de la garder', async () => {
    const user = userEvent.setup();
    mount({ max_concurrent_uploads: '5' });
    await user.type(screen.getByLabelText(t('settings.maxUploads')), '8');
    expect(onChange).toHaveBeenCalledWith('max_concurrent_uploads', '58');
  });

  it('remonte le changement d’unité — il change la valeur envoyée', async () => {
    const user = userEvent.setup();
    mount({ max_file_size: String(2 * 1024 ** 2) });
    await user.selectOptions(screen.getByLabelText(t('settings.sizeUnit')), 'GB');
    expect(onUnit).toHaveBeenCalledWith(FIELDS[1], 'GB');
  });
});
