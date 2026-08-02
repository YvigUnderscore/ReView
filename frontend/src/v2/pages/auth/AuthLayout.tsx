// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { fadeInUp } from '../../lib/motion';
import { useT } from '../../lib/i18n';
import { useBranding } from '../../lib/branding';
import LocaleSwitch from '../../components/LocaleSwitch';
import SourceNotice from '../../components/SourceNotice';

/**
 * Écran d'authentification scindé (10.B7) : panneau identité à gauche (logo, tagline,
 * dégradé subtil), formulaire à droite. Desktop-first ; le panneau gauche disparaît
 * sous `lg` pour ne garder que le formulaire centré.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const t = useT();
  // Thème studio (42.B — №101) : applique l'accent et affiche le logo du studio s'il existe.
  const { data: branding } = useBranding();
  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border p-10 lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <img
          src={branding?.logoUrl ?? '/logo_full.png'}
          alt={branding?.name ?? 'ReView'}
          className="relative h-11 w-auto self-start object-contain"
        />
        <div className="relative space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-sm text-muted-foreground">{subtitle}</p>
        </div>
        <p className="relative text-xs text-muted-foreground">{t('auth.tagline')}</p>
      </aside>
      <main className="relative flex items-center justify-center p-6">
        <div className="absolute right-4 top-4">
          <LocaleSwitch />
        </div>
        <motion.div variants={fadeInUp} initial="hidden" animate="show" className="w-full max-w-sm">
          {children}
        </motion.div>
        {/* AGPL §13 : offre de source visible avant même toute authentification. */}
        <SourceNotice className="absolute bottom-4 left-1/2 w-full max-w-md -translate-x-1/2 px-6 text-center" />
      </main>
    </div>
  );
}
