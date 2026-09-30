// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, FolderKanban } from 'lucide-react';
import type { Project } from '../../types/api';
import { projectPath } from '../../lib/slug';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useT } from '../../i18n';

/**
 * Sélecteur de projet en tête de barre latérale (C1).
 *
 * La barre listait les huit projets les plus récemment modifiés, chacun dépliable en un
 * arbre de séquences, de plans et d'assets. Deux conséquences : un projet plus ancien
 * n'apparaissait nulle part — pas même celui qu'on était en train de regarder — et
 * déplier une séquence chargeait tout son contenu pour n'afficher que des codes.
 *
 * La barre devient donc la navigation D'UN projet : celui-ci en tête, changeable d'un
 * clic, et en dessous ses sections. La liste complète reste à un clic, sans arbre.
 */
export default function ProjectSwitcher({
  projects,
  currentProjectId,
}: {
  projects: Project[];
  currentProjectId: number | null;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const current = projects.find((p) => p.id === currentProjectId) ?? null;

  const go = (project: Project) => {
    setOpen(false);
    void navigate(projectPath(project));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/70"
          title={t('sidebar.switchProject')}
        >
          <FolderKanban size={16} className="shrink-0 text-muted-foreground" />
          <span className={`min-w-0 flex-1 truncate ${current ? 'font-medium' : 'text-muted-foreground'}`}>
            {current ? current.name : t('sidebar.noProject')}
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 max-h-80 overflow-y-auto">
        {projects.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('sidebar.noProject')}</p>
        )}
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => go(project)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary"
          >
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {project.id === currentProjectId && <Check size={14} className="shrink-0 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
