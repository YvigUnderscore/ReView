// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { useT } from '../../i18n';
import { useBranding, DEFAULT_LOGIN_APPEARANCE, type LoginAppearance } from '../../lib/branding';
import LanguagePicker from '../../components/LanguagePicker';
import SourceNotice from '../../components/SourceNotice';
import { backdropStyle, overlayStyle } from './loginStyles';

/**
 * Split authentication screen (10.B7): identity panel on the left (logo, tagline,
 * subtle gradient), form on the right. Desktop-first; the left panel disappears
 * below `lg` to keep only the centred form.
 *
 * The styling (background image, veil, blur, layout, tagline) is set by the admin
 * in Admin → Login page and comes with the public branding.
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
  // Studio theme (42.B — №101): applies the accent and shows the studio logo if one exists.
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

  /**
   * Form entrance in CSS (F3): literal transcription of `fadeInUp`
   * (opacity 0→1, 8 px rise, 200 ms, `EASE_OUT` curve) — the login screen
   * had no other animation, and paid 38.5 KB gzip of framer-motion for it.
   */
  const appear =
    'animate-in fade-in slide-in-from-bottom-2 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none';

  if (login.layout === 'centered') {
    // Form centred on a full-page background: the layout that puts the image forward.
    return (
      <div className="relative grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <Backdrop login={login} />
        <div className="absolute right-4 top-4">
          <LanguagePicker className="py-1 text-xs" />
        </div>
        <div
          className={`relative w-full max-w-sm space-y-6 rounded-xl border border-border bg-background/80 p-6 shadow-xl backdrop-blur-md ${appear}`}
        >
          {logo && <div className="flex justify-center">{logo}</div>}
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
        </div>
        {/* AGPL §13: source offer visible even before any authentication. */}
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
        <div className={`w-full max-w-sm ${appear}`}>{children}</div>
        {/* AGPL §13: source offer visible even before any authentication. */}
        <SourceNotice className="absolute bottom-4 left-1/2 w-full max-w-md -translate-x-1/2 px-6 text-center" />
      </main>
    </div>
  );
}

/** Background image + veil, in absolute layers under the content. */
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
