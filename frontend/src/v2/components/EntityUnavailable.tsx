// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { FileQuestion, Lock, RotateCcw, TriangleAlert } from 'lucide-react';
import { ApiError } from '../../lib/apiClient';
import { isMissingOrForbidden } from './entityAvailability';
import { useT } from '../i18n';
import { Button } from './ui/button';
import PageShell from './PageShell';

/**
 * Ce qu'une page d'entité affiche quand son sujet n'existe pas, n'est pas accessible, ou
 * n'a pas pu être chargé.
 *
 * Sans elle, une page d'entité rendait sa coquille avec des données nulles : `/shots/999999`
 * affichait « Shots #999999 » et proposait « + Nouvelle version » et « Rattacher un asset »
 * sur un plan qui n'existe pas ; `/tasks/abc` allait jusqu'à « Tâche #NaN » avec une zone
 * de dépôt de fichiers active. Les pages publiques (partage, invitation) traitaient déjà
 * correctement le cas — c'est le même soin, porté aux pages internes.
 *
 * Trois situations, trois messages : l'entité n'existe pas (404), elle ne nous est pas
 * ouverte (403), ou le serveur n'a pas répondu — et dans ce dernier cas seulement, un
 * bouton « Réessayer », parce que c'est le seul cas où réessayer a un sens.
 */

export type EntityKind = 'shot' | 'sequence' | 'episode' | 'asset' | 'task' | 'project' | 'media';

interface Props {
  kind: EntityKind;
  /** L'erreur remontée par la query ; absente quand l'identifiant lui-même est invalide. */
  error?: unknown;
  onRetry?: () => void;
}

export default function EntityUnavailable({ kind, error, onRetry }: Props) {
  const t = useT();
  const forbidden = error instanceof ApiError && error.status === 403;
  const serverIssue = error !== undefined && !isMissingOrForbidden(error);

  const Icon = forbidden ? Lock : serverIssue ? TriangleAlert : FileQuestion;
  const title = forbidden
    ? t('entity.unavailable.forbidden')
    : serverIssue
      ? t('entity.unavailable.failed')
      : t(`entity.unavailable.missing.${kind}`);
  const hint = forbidden
    ? t('entity.unavailable.forbidden.hint')
    : serverIssue
      ? t('entity.unavailable.failed.hint')
      : t('entity.unavailable.missing.hint');

  return (
    <PageShell title={title}>
      <div className="flex min-h-[14rem] flex-col items-center justify-center gap-3 text-center">
        <Icon size={28} className="text-muted-foreground" aria-hidden />
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
        <div className="mt-1 flex gap-2">
          {serverIssue && onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw size={14} /> {t('error.boundary.retry')}
            </Button>
          )}
          <Button asChild size="sm">
            <Link to="/projects">{t('entity.unavailable.backToProjects')}</Link>
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
