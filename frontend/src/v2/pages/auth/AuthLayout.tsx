import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { fadeInUp } from '../../lib/motion';

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
  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border p-10 lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <img src="/logo_full.png" alt="ReView" className="relative h-11 w-auto self-start" />
        <div className="relative space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-sm text-muted-foreground">{subtitle}</p>
        </div>
        <p className="relative text-xs text-muted-foreground">
          Review collaborative de médias pour studios VFX &amp; post-production.
        </p>
      </aside>
      <main className="flex items-center justify-center p-6">
        <motion.div variants={fadeInUp} initial="hidden" animate="show" className="w-full max-w-sm">
          {children}
        </motion.div>
      </main>
    </div>
  );
}
