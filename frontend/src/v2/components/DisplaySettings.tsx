// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Monitor, Moon, Sun, Rows3, Rows4, type LucideIcon } from 'lucide-react';
import { useTheme, type ThemeMode } from '../stores/useTheme';
import { useDensity, type Density } from '../stores/useDensity';
import { useT } from '../i18n';
import { useUpdatePreferences } from '../lib/usePreferences';
import LanguagePicker from './LanguagePicker';
import TranslationNotice from './TranslationNotice';

/** Une option d'un contrôle segmenté. */
type Opt<T extends string> = { value: T; label: string; icon?: LucideIcon };

/** Contrôle segmenté générique (réglages d'affichage) — plusieurs choix exclusifs. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly Opt<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-border bg-background p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            {Icon && <Icon size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Une ligne « libellé + contrôle » du panneau. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Réglages d'affichage (42.A1) : thème (système/clair/sombre — №102), densité (№74) et
 * langue. Personnalisation locale (localStorage), appliquée instantanément sans flash.
 * Regroupe dans une seule section du profil plutôt que d'éparpiller des boutons (UI simple).
 */
export default function DisplaySettings() {
  const t = useT();
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const density = useDensity((s) => s.density);
  const setDensity = useDensity((s) => s.setDensity);
  // Le thème reste propre à l'appareil (un poste peut être en salle sombre) ; la langue et
  // la densité suivent le compte — le serveur se sert de la langue pour les emails, et
  // repartir en confortable sur chaque nouveau poste était une contrariété inutile (A2).
  const updatePrefs = useUpdatePreferences();

  const themeOpts: readonly Opt<ThemeMode>[] = [
    { value: 'system', label: t('display.theme.system'), icon: Monitor },
    { value: 'light', label: t('display.theme.light'), icon: Sun },
    { value: 'dark', label: t('display.theme.dark'), icon: Moon },
  ];
  const densityOpts: readonly Opt<Density>[] = [
    { value: 'comfortable', label: t('display.density.comfortable'), icon: Rows3 },
    { value: 'compact', label: t('display.density.compact'), icon: Rows4 },
  ];
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{t('display.title')}</h2>
      <Row label={t('display.theme')} hint={t('display.theme.hint')}>
        <Segmented value={mode} options={themeOpts} onChange={setMode} ariaLabel={t('display.theme')} />
      </Row>
      <Row label={t('display.density')} hint={t('display.density.hint')}>
        <Segmented
          value={density}
          options={densityOpts}
          onChange={(d) => {
            setDensity(d);
            updatePrefs.mutate({ density: d });
          }}
          ariaLabel={t('display.density')}
        />
      </Row>
      <Row label={t('display.language')} hint={t('display.language.hint')}>
        <LanguagePicker
          id="display-language"
          className="py-1 text-xs"
          onSelect={(locale) => updatePrefs.mutate({ locale })}
        />
      </Row>
      <TranslationNotice />
    </section>
  );
}
