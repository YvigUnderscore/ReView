// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { t } from '../../i18n';
import { Button } from './button';

/**
 * Render error boundary.
 *
 * React unmounts the whole tree when a component throws during render: without a boundary,
 * any exception left a blank screen — no header, no navigation, no message, and no way out
 * but F5. The risk is not theoretical here: review pages mount Three.js, Spark and
 * Excalidraw, and many screens index server data without a guard.
 *
 * It is placed at three levels, from finest to coarsest — the viewer, the content area of
 * the shell, the root — so that a crash takes down as little as possible: when the viewer
 * falls over, the comments panel and navigation remain usable.
 *
 * `Suspense` does not replace this component: it only catches pending promises, not
 * exceptions.
 */

interface Props {
  children: ReactNode;
  /** Custom fallback block. By default: the panel below. */
  fallback?: (reset: () => void) => ReactNode;
  /** Scope shown in the technical detail ("review", "board", ...). */
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
    // No `console.log` anywhere else in the application, but here there is no other
    // channel: without this trace, a render exception leaves nothing behind.
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
