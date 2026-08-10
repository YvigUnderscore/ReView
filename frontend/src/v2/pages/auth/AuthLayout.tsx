// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { fadeInUp } from '../../lib/motion';
import { useT } from '../../i18n';
import { useBranding, DEFAULT_LOGIN_APPEARANCE, type LoginAppearance } from '../../lib/branding';
import LanguagePicker from '../../components/LanguagePicker';
import SourceNotice from '../../components/SourceNotice';
import { backdropStyle, overlayStyle } from './loginStyles';

/**
 * Écran d'authentification scindé (10.B7) : panneau identité à gauche (logo, tagline,
 * dégradé subtil), formulaire à droite. Desktop-first ; le panneau gauche disparaît
 * sous `lg` pour ne garder que le formulaire centré.
 *
 * L'habillage (image de fond, voile, flou, disposition, accroche) est réglé par l'admin
 * dans Admin → Page de connexion et arrive avec le branding public.
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
  const login = branding?.login ?? DEFAULT_LOGIN_APPEARANCE;
  const tagline = login.tagline || t('auth.tagline');
  const logo = login.showLogo ? (
    <img
      src={branding?.logoUrl ?? '/logo_full.png'}
      alt={branding?.name ?? 'ReView'}
      className="relative h-11 w-auto self-start object-contain"
    />
  ) : null;

  if (login.layout === 'centered') {
    // Formulaire centré sur un fond pleine page : la mise en page qui met l'image en avant.
    return (
      <div className="relative grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <Backdrop login={login} />
        <div className="absolute right-4 top-4">
          <LanguagePicker className="py-1 text-xs" />
        </div>
        <motion.div
          variants={fadeInUp}
          initial="hidden"
          animate="show"
          className="relative w-full max-w-sm space-y-6 rounded-xl border border-border bg-background/80 p-6 shadow-xl backdrop-blur-md"
        >
          {logo && <div className="flex justify-center">{logo}</div>}
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
        </motion.div>
        {/* AGPL §13 : offre de source visible avant même toute authentification. */}
        <SourceNotice className="absolute bottom-4 left-1/2 w-full max-w-md -translate-x-1/2 px-6 text-center" />
      </div>
    );
  }

  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border p-10 lg:flex">
        <Backdrop login={login} />
        {!login.bgUrl && (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          </>
        )}
        {logo ?? <span />}
        <div className="relative space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-sm text-muted-foreground">{subtitle}</p>
        </div>
        <p className="relative text-xs text-muted-foreground">{tagline}</p>
      </aside>
      <main className="relative flex items-center justify-center p-6">
        <div className="absolute right-4 top-4">
          <LanguagePicker className="py-1 text-xs" />
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

/** Image de fond + voile, en couches absolues sous le contenu. */
export function Backdrop({ login }: { login: LoginAppearance }) {
  const bg = backdropStyle(login);
  if (!bg) return null;
  const veil = overlayStyle(login);
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0" style={bg} />
      </div>
      {veil && <div aria-hidden className="pointer-events-none absolute inset-0" style={veil} />}
    </>
  );
}
