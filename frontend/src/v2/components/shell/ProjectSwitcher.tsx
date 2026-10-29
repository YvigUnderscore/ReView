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
 * Project selector at the head of the sidebar (C1).
 *
 * The bar used to list the eight most recently modified projects, each expandable into a tree of sequences, shots and
 * assets. Two consequences: an older project appeared nowhere, not even the one one was looking at, and expanding a
 * sequence loaded all its content just to display codes.
 *
 * The bar therefore becomes the navigation OF ONE project: this one at the head, changeable with one click, and its
 * sections beneath it. The full list remains one click away, without a tree.
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
