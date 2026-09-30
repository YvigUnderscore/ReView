// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { t } from '../../i18n';
import { Button } from './button';

/**
 * Frontière d'erreur de rendu.
 *
 * React démonte l'arbre entier quand un composant jette pendant le rendu : sans frontière,
 * la moindre exception laissait un écran blanc — sans en-tête, sans navigation, sans
 * message, sans autre issue que F5. Le risque n'a rien de théorique ici : les pages de
 * review montent Three.js, Spark et Excalidraw, et beaucoup d'écrans indexent des données
 * serveur sans garde.
 *
 * Posée à trois niveaux, du plus fin au plus grossier — le viewer, la zone de contenu de la
 * coquille, la racine — pour qu'un plantage emporte le moins de surface possible : quand le
 * viewer tombe, le panneau de commentaires et la navigation restent utilisables.
 *
 * `Suspense` ne remplace pas ce composant : il n'attrape que les promesses en attente, pas
 * les exceptions.
 */

interface Props {
  children: ReactNode;
  /** Bloc de repli sur mesure. Par défaut : le panneau ci-dessous. */
  fallback?: (reset: () => void) => ReactNode;
  /** Portée affichée dans le détail technique (« review », « board »…). */
  scope?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Pas de `console.log` ailleurs dans l'application, mais ici il n'y a pas d'autre
    // canal : sans cette trace, une exception de rendu ne laisse rien derrière elle.
    console.error(
      `[ErrorBoundary${this.props.scope ? ` ${this.props.scope}` : ''}]`,
      error,
      info.componentStack,
    );
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 p-8 text-center">
        <TriangleAlert size={28} className="text-destructive" aria-hidden />
        <h2 className="text-base font-medium text-foreground">{t('error.boundary.title')}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{t('error.boundary.description')}</p>
        <div className="mt-1 flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={this.reset}>
            <RotateCcw size={14} /> {t('error.boundary.retry')}
          </Button>
          <Button type="button" size="sm" onClick={() => window.location.reload()}>
            {t('error.boundary.reload')}
          </Button>
        </div>
        <details className="mt-2 max-w-full text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t('error.boundary.details')}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded border border-border bg-muted/40 p-2 text-2xs text-muted-foreground">
            {error.message}
          </pre>
        </details>
      </div>
    );
  }
}

export default ErrorBoundary;
